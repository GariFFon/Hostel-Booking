import type { Prisma, RoomUnit } from '@/generated/prisma/client';
import { prisma } from '@/infra/db/prisma';
import { Errors } from '@/core/errors/app-error';
import type { Actor } from '@/core/context/request-context';
import { requireRole } from '@/core/auth/rbac';
import { recordAudit } from '@/modules/audit/audit.service';
import { loadOwnedRoomType } from '@/modules/hostels/hostels.policy';
import { stayModeOf } from '@/modules/hostels/property-mode';
import { freeUnits } from '@/modules/tenancies/tenancy.rules';
import type { CreateUnitsInput, UpdateUnitInput } from './units.schema';

type Db = Prisma.TransactionClient;

const toDto = (u: RoomUnit) => ({
  id: u.id, roomTypeId: u.roomTypeId, label: u.label, floor: u.floor, status: u.status, notes: u.notes,
  createdAt: u.createdAt.toISOString(), updatedAt: u.updatedAt.toISOString(),
});

/** Units that count toward capacity: live and not retired. */
const COUNTED = { deletedAt: null, status: { not: 'RETIRED' as const } };

async function loadOwnedUnit(db: Db, actor: Actor, unitId: string) {
  requireRole(actor, 'OWNER');
  const unit = await db.roomUnit.findFirst({ where: { id: unitId, deletedAt: null, roomType: { deletedAt: null, hostel: { ownerId: actor.id, deletedAt: null } } }, include: { roomType: { include: { hostel: true } } } });
  if (!unit) throw Errors.notFound('Unit');
  return unit;
}

const assertLongTerm = (propertyType: Parameters<typeof stayModeOf>[0]) => {
  if (stayModeOf(propertyType) !== 'TENANCY') throw Errors.conflict('Hotels are booked by room type. Units are only tracked for hostels and PGs.');
};

/** Postgres unique violation on the (room type, lower(label)) index. */
const isDuplicateLabel = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

/**
 * Physical beds/rooms of long-term properties (e.g. "204-B3"). Tenancies (phase 11) are assigned to a unit.
 * Owners manage units whatever the listing status: this is day-to-day operations, not listing content.
 */
export const unitsService = {
  async list(actor: Actor, roomTypeId: string) {
    const room = await loadOwnedRoomType(prisma, actor, roomTypeId);
    const rows = await prisma.roomUnit.findMany({ where: { roomTypeId: room.id, deletedAt: null }, orderBy: [{ floor: 'asc' }, { label: 'asc' }] });
    return rows.map(toDto);
  },

  /** Beds nobody holds: what an owner can still hand to a tenant. */
  async listFree(actor: Actor, roomTypeId: string) {
    const room = await loadOwnedRoomType(prisma, actor, roomTypeId);
    return (await freeUnits(prisma, room.id)).map(toDto);
  },

  async create(actor: Actor, roomTypeId: string, input: CreateUnitsInput) {
    return prisma.$transaction(async (tx) => {
      const room = await loadOwnedRoomType(tx, actor, roomTypeId);
      assertLongTerm(room.hostel.propertyType);
      const labels = input.labels.map((l) => l.trim());
      if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) throw Errors.validation([{ path: 'labels', message: 'Each unit needs a different label' }]);
      const counted = await tx.roomUnit.count({ where: { roomTypeId: room.id, ...COUNTED } });
      if (counted + labels.length > room.totalUnits) {
        throw Errors.conflict(`This room type has ${room.totalUnits} units and ${counted} are already listed. Raise its total units first.`);
      }
      let created: RoomUnit[];
      try {
        created = await Promise.all(labels.map((label) => tx.roomUnit.create({ data: { roomTypeId: room.id, label, floor: input.floor ?? null } })));
      } catch (e) {
        if (isDuplicateLabel(e)) throw Errors.conflict('A unit with one of these labels already exists in this room type');
        throw e;
      }
      await recordAudit({ action: 'unit.create', entityType: 'room_type', entityId: room.id, after: { labels }, metadata: { hostelId: room.hostelId, count: created.length } }, tx);
      return created.map(toDto);
    });
  },

  async update(actor: Actor, unitId: string, input: UpdateUnitInput) {
    return prisma.$transaction(async (tx) => {
      const unit = await loadOwnedUnit(tx, actor, unitId);
      // Bringing a retired unit back counts toward capacity again.
      if (input.status && input.status !== 'RETIRED' && unit.status === 'RETIRED') {
        const counted = await tx.roomUnit.count({ where: { roomTypeId: unit.roomTypeId, ...COUNTED } });
        if (counted + 1 > unit.roomType.totalUnits) throw Errors.conflict('This room type is at capacity. Raise its total units first.');
      }
      let after: RoomUnit;
      try {
        after = await tx.roomUnit.update({ where: { id: unit.id }, data: input });
      } catch (e) {
        if (isDuplicateLabel(e)) throw Errors.conflict('A unit with this label already exists in this room type');
        throw e;
      }
      await recordAudit({ action: 'unit.update', entityType: 'room_unit', entityId: unit.id, before: toDto(unit), after: toDto(after), metadata: { hostelId: unit.roomType.hostelId, roomTypeId: unit.roomTypeId } }, tx);
      return toDto(after);
    });
  },

  /** Soft delete: the label becomes reusable. Phase 11 will also refuse while a tenancy occupies the unit. */
  async remove(actor: Actor, unitId: string) {
    await prisma.$transaction(async (tx) => {
      const unit = await loadOwnedUnit(tx, actor, unitId);
      await tx.roomUnit.update({ where: { id: unit.id }, data: { deletedAt: new Date(), status: 'RETIRED' } });
      await recordAudit({ action: 'unit.delete', entityType: 'room_unit', entityId: unit.id, before: toDto(unit), metadata: { hostelId: unit.roomType.hostelId, roomTypeId: unit.roomTypeId } }, tx);
    });
  },
};
