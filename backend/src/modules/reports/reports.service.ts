import { Errors } from '@/core/errors/app-error';
import { requireRole } from '@/core/auth/rbac';
import type { Actor } from '@/core/context/request-context';
import { diffDays, todayIn, toDateString } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import type { DuesReport, OccupancyReport } from './reports.schema';

const PLATFORM_TZ = 'Asia/Kolkata';
/** Beds held by a tenancy in each state. */
const OCCUPIED = ['ACTIVE'] as const;
const RESERVED = ['INVITED', 'PENDING_MOVE_IN'] as const;
const pct = (num: number, den: number) => (den <= 0 ? 0 : Math.round((num / den) * 1000) / 10);

async function ownedLongTerm(actor: Actor, hostelId?: string) {
  const hostels = await prisma.hostel.findMany({ where: { ownerId: actor.id, deletedAt: null, propertyType: { in: ['HOSTEL', 'PG'] }, ...(hostelId ? { id: hostelId } : {}) }, select: { id: true, name: true, city: true, propertyType: true, timezone: true }, orderBy: { name: 'asc' } });
  if (hostelId && hostels.length === 0) throw Errors.notFound('Property'); // not theirs, or not a long-term property: looks missing
  return hostels;
}

export const reportsService = {
  /** Beds by state: lived in, leaving soon (notice), reserved for someone, out of service, and free. */
  async occupancy(actor: Actor, q: { hostelId?: string }): Promise<OccupancyReport> {
    requireRole(actor, 'OWNER');
    const hostels = await ownedLongTerm(actor, q.hostelId);
    const today = todayIn(PLATFORM_TZ);
    const units = await prisma.roomUnit.findMany({
      where: { deletedAt: null, status: { not: 'RETIRED' }, roomType: { hostelId: { in: hostels.map((h) => h.id) }, deletedAt: null } },
      select: { id: true, status: true, roomType: { select: { id: true, name: true, hostelId: true } }, tenancies: { where: { status: { in: ['ACTIVE', 'NOTICE', 'INVITED', 'PENDING_MOVE_IN'] } }, select: { status: true } } },
    });
    const empty = () => ({ units: 0, occupied: 0, onNotice: 0, reserved: 0, maintenance: 0, vacant: 0 });
    const byHostel = new Map(hostels.map((h) => [h.id, { ...empty(), rooms: new Map<string, { name: string } & ReturnType<typeof empty>>() }]));
    for (const u of units) {
      const h = byHostel.get(u.roomType.hostelId)!;
      const room = h.rooms.get(u.roomType.id) ?? { name: u.roomType.name, ...empty() };
      h.rooms.set(u.roomType.id, room);
      const state = u.status === 'MAINTENANCE' ? 'maintenance' : u.tenancies.some((t) => (OCCUPIED as readonly string[]).includes(t.status)) ? 'occupied' : u.tenancies.some((t) => t.status === 'NOTICE') ? 'onNotice' : u.tenancies.some((t) => (RESERVED as readonly string[]).includes(t.status)) ? 'reserved' : 'vacant';
      for (const bucket of [h, room]) { bucket.units++; bucket[state]++; }
    }
    const rows = hostels.map((h) => {
      const v = byHostel.get(h.id)!;
      return {
        hostelId: h.id, name: h.name, city: h.city, propertyType: h.propertyType, units: v.units, occupied: v.occupied, onNotice: v.onNotice, reserved: v.reserved, maintenance: v.maintenance, vacant: v.vacant,
        occupancyPct: pct(v.occupied + v.onNotice, v.units - v.maintenance),
        byRoom: [...v.rooms.entries()].map(([roomTypeId, r]) => ({ roomTypeId, name: r.name, units: r.units, occupied: r.occupied, onNotice: r.onNotice, reserved: r.reserved, maintenance: r.maintenance, vacant: r.vacant })).sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
    const sum = (k: 'units' | 'occupied' | 'onNotice' | 'reserved' | 'maintenance' | 'vacant') => rows.reduce((n, r) => n + r[k], 0);
    const soon = await prisma.tenancy.findMany({
      where: { status: 'NOTICE', endDate: { not: null }, hostelId: { in: hostels.map((h) => h.id) } }, orderBy: { endDate: 'asc' }, take: 50,
      select: { id: true, endDate: true, unit: { select: { label: true } }, hostel: { select: { name: true } }, tenant: { select: { profile: { select: { fullName: true } }, email: true } } },
    });
    return {
      asOf: today,
      totals: { units: sum('units'), occupied: sum('occupied'), onNotice: sum('onNotice'), reserved: sum('reserved'), maintenance: sum('maintenance'), vacant: sum('vacant'), occupancyPct: pct(sum('occupied') + sum('onNotice'), sum('units') - sum('maintenance')) },
      byHostel: rows,
      vacatingSoon: soon.map((t) => ({ tenancyId: t.id, tenant: t.tenant?.profile?.fullName ?? t.tenant?.email ?? null, hostel: t.hostel.name, unitLabel: t.unit.label, moveOutDate: toDateString(t.endDate!), daysLeft: diffDays(today, toDateString(t.endDate!)) })),
    };
  },

  /** Rent still owed, by how overdue it is, and who owes it. */
  async dues(actor: Actor, q: { hostelId?: string }): Promise<DuesReport> {
    requireRole(actor, 'OWNER');
    const hostels = await ownedLongTerm(actor, q.hostelId);
    const today = todayIn(PLATFORM_TZ);
    const open = await prisma.rentInvoice.findMany({
      where: { status: { in: ['DUE', 'PARTIALLY_PAID'] }, hostelId: { in: hostels.map((h) => h.id) } }, orderBy: { dueDate: 'asc' }, take: 5000,
      select: { id: true, tenancyId: true, totalPaise: true, paidPaise: true, dueDate: true, overdueAfter: true, hostel: { select: { name: true } }, tenancy: { select: { unit: { select: { label: true } } } }, tenant: { select: { email: true, profile: { select: { fullName: true } } } } },
    });
    const buckets = { NOT_DUE: { label: 'Not overdue yet', invoices: 0, owedPaise: 0 }, D1_7: { label: '1 to 7 days', invoices: 0, owedPaise: 0 }, D8_30: { label: '8 to 30 days', invoices: 0, owedPaise: 0 }, D31_60: { label: '31 to 60 days', invoices: 0, owedPaise: 0 }, D60_PLUS: { label: 'Over 60 days', invoices: 0, owedPaise: 0 } };
    const byTenancy = new Map<string, DuesReport['rows'][number]>();
    let overdue = 0;
    for (const i of open) {
      const owed = i.totalPaise - i.paidPaise;
      if (owed <= 0) continue;
      const late = Math.max(diffDays(toDateString(i.overdueAfter), today), 0);
      const key = late === 0 ? 'NOT_DUE' : late <= 7 ? 'D1_7' : late <= 30 ? 'D8_30' : late <= 60 ? 'D31_60' : 'D60_PLUS';
      buckets[key].invoices++; buckets[key].owedPaise += owed;
      if (late > 0) overdue += owed;
      const row = byTenancy.get(i.tenancyId) ?? { tenancyId: i.tenancyId, tenant: i.tenant.profile?.fullName ?? null, email: i.tenant.email, hostel: i.hostel.name, unitLabel: i.tenancy.unit.label, invoices: 0, owedPaise: 0, oldestDueDate: toDateString(i.dueDate), daysOverdue: 0 };
      row.invoices++; row.owedPaise += owed; row.daysOverdue = Math.max(row.daysOverdue, late);
      if (toDateString(i.dueDate) < row.oldestDueDate) row.oldestDueDate = toDateString(i.dueDate);
      byTenancy.set(i.tenancyId, row);
    }
    const rows = [...byTenancy.values()].sort((a, b) => b.daysOverdue - a.daysOverdue || b.owedPaise - a.owedPaise);
    return {
      asOf: today,
      totals: { tenants: rows.length, invoices: open.length, owedPaise: Object.values(buckets).reduce((n, b) => n + b.owedPaise, 0), overduePaise: overdue },
      buckets: (Object.keys(buckets) as (keyof typeof buckets)[]).map((key) => ({ key, ...buckets[key] })),
      rows: rows.slice(0, 200),
    };
  },
};
