import { Prisma } from '@/generated/prisma/client';
import { requireRole } from '@/core/auth/rbac';
import type { Actor } from '@/core/context/request-context';
import { addDays, todayIn } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';

const { sql } = Prisma;

/**
 * Owner earnings straight from the append-only ledger, so the figures always reconcile with the money movements.
 * "Settled" = escrow already released (completed stays, no-shows, cancellations with a retained part).
 */
export const earningsService = {
  async summary(actor: Actor, q: { from?: string; to?: string; hostelId?: string }) {
    requireRole(actor, 'OWNER');
    const to = q.to ?? todayIn('Asia/Kolkata');
    const from = q.from ?? addDays(to, -29);
    const hostelFilter = q.hostelId ? sql`AND h.id = ${q.hostelId}::uuid` : sql``;
    const range = sql`le.created_at >= ${from}::date AND le.created_at < (${to}::date + interval '1 day')`;

    const [tot] = await prisma.$queryRaw<{ owner: bigint | null; commission: bigint | null; tax: bigint | null; refunded: bigint | null; bookings: bigint }[]>(sql`
      SELECT
        sum(le.amount_paise) FILTER (WHERE le.credit_account = 'OWNER_PAYABLE') AS owner,
        sum(le.amount_paise) FILTER (WHERE le.credit_account = 'PLATFORM_REVENUE' AND le.debit_account = 'PLATFORM_ESCROW') AS commission,
        sum(le.amount_paise) FILTER (WHERE le.credit_account = 'TAX_PAYABLE') AS tax,
        sum(le.amount_paise) FILTER (WHERE le.credit_account = 'REFUND_PAYABLE') AS refunded,
        count(DISTINCT le.booking_id) FILTER (WHERE le.credit_account = 'OWNER_PAYABLE') AS bookings
      FROM ledger_entries le JOIN bookings b ON b.id = le.booking_id JOIN hostels h ON h.id = b.hostel_id
      WHERE h.owner_id = ${actor.id}::uuid AND ${range} ${hostelFilter}`);

    const perHostel = await prisma.$queryRaw<{ hostel_id: string; name: string; bookings: bigint; owner: bigint }[]>(sql`
      SELECT h.id::text AS hostel_id, h.name, count(DISTINCT le.booking_id) AS bookings, sum(le.amount_paise) AS owner
      FROM ledger_entries le JOIN bookings b ON b.id = le.booking_id JOIN hostels h ON h.id = b.hostel_id
      WHERE h.owner_id = ${actor.id}::uuid AND le.credit_account = 'OWNER_PAYABLE' AND ${range} ${hostelFilter}
      GROUP BY h.id, h.name ORDER BY sum(le.amount_paise) DESC`);

    const [up] = await prisma.$queryRaw<{ bookings: bigint; expected: bigint | null }[]>(sql`
      SELECT count(*) AS bookings,
             sum((b.subtotal_paise - b.discount_paise) - round((b.subtotal_paise - b.discount_paise) * b.commission_bps / 10000.0)) AS expected
      FROM bookings b JOIN hostels h ON h.id = b.hostel_id
      WHERE h.owner_id = ${actor.id}::uuid AND b.status IN ('CONFIRMED', 'CHECKED_IN') ${hostelFilter}`);

    return {
      from, to, currency: 'INR',
      settled: { bookings: Number(tot?.bookings ?? 0), ownerPayablePaise: Number(tot?.owner ?? 0), commissionPaise: Number(tot?.commission ?? 0), taxPaise: Number(tot?.tax ?? 0), refundedPaise: Number(tot?.refunded ?? 0) },
      upcoming: { bookings: Number(up?.bookings ?? 0), expectedOwnerPaise: Number(up?.expected ?? 0) },
      byHostel: perHostel.map((r) => ({ hostelId: r.hostel_id, name: r.name, bookings: Number(r.bookings), ownerPayablePaise: Number(r.owner) })),
    };
  },
};

