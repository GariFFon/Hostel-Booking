import type { Prisma } from '@/generated/prisma/client';
import type { Actor } from '@/core/context/request-context';
import { todayIn } from '@/core/dates';
import { Errors } from '@/core/errors/app-error';
import { invalidateHostel, invalidateInventory } from '@/infra/cache/invalidation';
import { prisma } from '@/infra/db/prisma';
import { recordAudit } from '@/modules/audit/audit.service';
import { ensureInventory, getCalendar, setBlocks, setTotalUnits } from '@/modules/availability/inventory.service';
import { hasLiveBookings, loadOwnedHostel, loadOwnedRoomType } from '@/modules/hostels/hostels.policy';
import { OWNER_EDITABLE } from '@/modules/hostels/hostels.status';
import { toRoomTypeDto } from './rooms.mapper';
import { validateRoomShape, type CreateRoomTypeInput, type UpdateRoomTypeInput } from './rooms.schema';

const MAX_ROOM_TYPES = 30;

/** Keeps the denormalised "from ₹X" price on the hostel in step with its active rooms. */
export async function refreshHostelAggregates(db: Prisma.TransactionClient, hostelId: string) {
  const agg = await db.roomType.aggregate({ where: { hostelId, isActive: true, deletedAt: null }, _min: { basePricePaise: true } });
  await db.hostel.update({ where: { id: hostelId }, data: { minPricePaise: agg._min.basePricePaise } });
}

const assertEditable = (status: Parameters<typeof OWNER_EDITABLE.includes>[0]) => {
  if (!OWNER_EDITABLE.includes(status)) throw Errors.conflict('Withdraw the listing from review before editing it');
};

function assertMonthlyOnlyForPg(priceUnit: string, propertyType: string) {
  if (priceUnit === 'MONTH' && propertyType !== 'PG') throw Errors.validation([{ path: 'priceUnit', message: 'Monthly pricing is only available for PG listings' }]);
}

export const roomsService = {
  async list(actor: Actor, hostelId: string) {
    const hostel = await loadOwnedHostel(prisma, actor, hostelId);
    return (await prisma.roomType.findMany({ where: { hostelId: hostel.id, deletedAt: null }, orderBy: { createdAt: 'asc' } })).map(toRoomTypeDto);
  },

  async get(actor: Actor, roomTypeId: string) {
    return toRoomTypeDto(await loadOwnedRoomType(prisma, actor, roomTypeId));
  },

  async create(actor: Actor, hostelId: string, input: CreateRoomTypeInput) {
    const result = await prisma.$transaction(async (tx) => {
      const hostel = await loadOwnedHostel(tx, actor, hostelId);
      assertEditable(hostel.status);
      assertMonthlyOnlyForPg(input.priceUnit, hostel.propertyType);
      if ((await tx.roomType.count({ where: { hostelId, deletedAt: null } })) >= MAX_ROOM_TYPES) throw Errors.conflict(`A listing can have at most ${MAX_ROOM_TYPES} room types`);
      const room = await tx.roomType.create({ data: { ...input, hostelId } });
      await ensureInventory(tx, room.id, room.totalUnits, todayIn(hostel.timezone));
      await refreshHostelAggregates(tx, hostelId);
      await recordAudit({ action: 'room_type.create', entityType: 'hostel', entityId: hostelId, after: toRoomTypeDto(room) }, tx);
      return toRoomTypeDto(room);
    });
    await invalidateHostel(hostelId);
    return result;
  },

  async update(actor: Actor, roomTypeId: string, input: UpdateRoomTypeInput) {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await loadOwnedRoomType(tx, actor, roomTypeId);
      assertEditable(existing.hostel.status);
      if (input.expectedVersion !== undefined && input.expectedVersion !== existing.version) throw Errors.conflict('This room type was changed elsewhere. Reload and try again.', { currentVersion: existing.version });
      const { expectedVersion: _ignored, ...changes } = input;
      const merged = { ...existing, ...changes };
      const issues = validateRoomShape(merged);
      if (issues.length) throw Errors.validation(issues);
      assertMonthlyOnlyForPg(merged.priceUnit, existing.hostel.propertyType);

      if (changes.totalUnits !== undefined && changes.totalUnits !== existing.totalUnits) {
        await setTotalUnits(tx, roomTypeId, changes.totalUnits, existing.hostel.timezone);
      }
      if (changes.isActive === false && existing.hostel.status === 'APPROVED') {
        const others = await tx.roomType.count({ where: { hostelId: existing.hostelId, isActive: true, deletedAt: null, id: { not: roomTypeId } } });
        if (others === 0) throw Errors.conflict('A published listing needs at least one active room type');
      }
      const room = await tx.roomType.update({ where: { id: roomTypeId }, data: { ...changes, version: { increment: 1 } } });
      await refreshHostelAggregates(tx, existing.hostelId);
      await recordAudit({ action: 'room_type.update', entityType: 'hostel', entityId: existing.hostelId, before: toRoomTypeDto(existing), after: toRoomTypeDto(room) }, tx);
      return toRoomTypeDto(room);
    });
    await invalidateHostel(result.hostelId);
    return result;
  },

  async remove(actor: Actor, roomTypeId: string) {
    const hostelId = await prisma.$transaction(async (tx) => {
      const existing = await loadOwnedRoomType(tx, actor, roomTypeId);
      assertEditable(existing.hostel.status);
      if (await hasLiveBookings(tx, existing.hostelId, existing.hostel.timezone, roomTypeId)) {
        throw Errors.conflict('This room type has upcoming or active bookings. Deactivate it instead, or cancel those bookings first.');
      }
      if (existing.hostel.status === 'APPROVED') {
        const others = await tx.roomType.count({ where: { hostelId: existing.hostelId, isActive: true, deletedAt: null, id: { not: roomTypeId } } });
        if (others === 0) throw Errors.conflict('A published listing needs at least one active room type');
      }
      await tx.roomType.update({ where: { id: roomTypeId }, data: { deletedAt: new Date(), isActive: false } });
      await tx.priceRule.deleteMany({ where: { roomTypeId } });
      await refreshHostelAggregates(tx, existing.hostelId);
      await recordAudit({ action: 'room_type.delete', entityType: 'hostel', entityId: existing.hostelId, before: toRoomTypeDto(existing) }, tx);
      return existing.hostelId;
    });
    await invalidateHostel(hostelId);
  },

  async setBlocks(actor: Actor, roomTypeId: string, input: { from: string; to: string; units: number; reason?: string | null }) {
    const result = await prisma.$transaction(async (tx) => {
      const room = await loadOwnedRoomType(tx, actor, roomTypeId);
      if (input.units > room.totalUnits) throw Errors.validation([{ path: 'units', message: `This room type only has ${room.totalUnits} units` }]);
      const result = await setBlocks(tx, roomTypeId, room.hostel.timezone, input);
      await recordAudit({ action: input.units === 0 ? 'calendar.unblock' : 'calendar.block', entityType: 'room_type', entityId: roomTypeId, after: input }, tx);
      return result;
    });
    await invalidateInventory();
    return result;
  },

  async calendar(actor: Actor, roomTypeId: string, from: string, to: string) {
    const room = await loadOwnedRoomType(prisma, actor, roomTypeId);
    return getCalendar(prisma, room.id, from, to);
  },
};
