import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/infra/db/prisma';
import { makeOwnerWithHostel } from '../helpers/db';

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('audit_logs: tamper-evident, append-only', () => {
  it('chains hashes in the database and verifies clean', async () => {
    for (let i = 0; i < 5; i++) {
      await prisma.auditLog.create({
        data: { action: 'test.event', entityType: 'test', entityId: String(i), after: { i } },
      });
    }
    const rows = await prisma.auditLog.findMany({ orderBy: { id: 'asc' }, take: 5 });
    expect(rows.every((r) => r.hash && r.hash.length === 64)).toBe(true);
    rows.slice(1).forEach((r, i) => expect(r.prevHash).toBe(rows[i]!.hash));
    const broken = await prisma.$queryRaw<{ bad_id: bigint }[]>`SELECT * FROM audit_verify_chain(0)`;
    expect(broken).toHaveLength(0);
  });

  it('keeps the chain intact under concurrent inserts', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        prisma.auditLog.create({ data: { action: 'test.concurrent', entityType: 'test', entityId: `c${i}` } }),
      ),
    );
    const broken = await prisma.$queryRaw<{ bad_id: bigint }[]>`SELECT * FROM audit_verify_chain(0)`;
    expect(broken).toHaveLength(0);
  });

  it('rejects UPDATE, DELETE and TRUNCATE', async () => {
    const row = await prisma.auditLog.create({ data: { action: 'x', entityType: 'test' } });
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: 'y' } })).rejects.toThrow(
      /append-only/,
    );
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE audit_logs')).rejects.toThrow(/append-only/);
  });
});

describe('inventory_nights: no overbooking by construction', () => {
  let roomTypeId: string;
  beforeAll(async () => {
    const { hostel } = await makeOwnerWithHostel();
    const rt = await prisma.roomType.create({
      data: { hostelId: hostel.id, name: '6-bed dorm', kind: 'DORM', totalUnits: 5, basePricePaise: 80000 },
    });
    roomTypeId = rt.id;
    await prisma.inventoryNight.create({ data: { roomTypeId, date: D('2027-01-10'), totalUnits: 5 } });
  });
  afterAll(async () => {
    await prisma.inventoryNight.deleteMany({ where: { roomTypeId } });
  });

  it('refuses held + booked > total at the database level', async () => {
    await expect(
      prisma.inventoryNight.update({
        where: { roomTypeId_date: { roomTypeId, date: D('2027-01-10') } },
        data: { heldUnits: 3, bookedUnits: 3 },
      }),
    ).rejects.toThrow(/inventory_capacity|check constraint/i);
  });

  it('conditional UPDATE lets exactly `total` of 50 parallel single-bed holds succeed', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        prisma.$executeRaw`
          UPDATE inventory_nights SET held_units = held_units + 1
          WHERE room_type_id = ${roomTypeId}::uuid AND date = ${D('2027-01-10')}
            AND held_units + booked_units + 1 <= total_units`,
      ),
    );
    expect(results.filter((n) => n === 1)).toHaveLength(5);
    const row = await prisma.inventoryNight.findUniqueOrThrow({
      where: { roomTypeId_date: { roomTypeId, date: D('2027-01-10') } },
    });
    expect(row.heldUnits).toBe(5);
  });
});

describe('check constraints', () => {
  it('rejects bookings whose total does not add up', async () => {
    const { user, hostel } = await makeOwnerWithHostel();
    await expect(
      prisma.booking.create({
        data: {
          code: `HB-T${Date.now()}`, guestId: user.id, hostelId: hostel.id, checkIn: D('2027-02-01'),
          checkOut: D('2027-02-03'), nights: 2, guestsCount: 1, subtotalPaise: 1000, taxPaise: 50,
          gstRateBps: 500, totalPaise: 999, commissionBps: 1000, cancellationPolicy: 'MODERATE', bookingMode: 'INSTANT',
        },
      }),
    ).rejects.toThrow(/bookings_total_consistent/);
  });

  it('rejects mixed-case emails', async () => {
    await expect(prisma.user.create({ data: { email: 'Mixed@Case.com' } })).rejects.toThrow(/users_email_lowercase/);
  });
});

describe('geo + trigram indexes', () => {
  it('finds hostels within a radius using earthdistance', async () => {
    await makeOwnerWithHostel(); // Goa 15.5, 73.8
    const near = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM hostels
      WHERE deleted_at IS NULL AND earth_box(ll_to_earth(15.5, 73.8), 5000) @> ll_to_earth(latitude, longitude)
        AND earth_distance(ll_to_earth(15.5, 73.8), ll_to_earth(latitude, longitude)) <= 5000`;
    expect(near.length).toBeGreaterThan(0);
  });
});
