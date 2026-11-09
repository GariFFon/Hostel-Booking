import { requireRole } from '@/core/auth/rbac';
import type { Actor } from '@/core/context/request-context';
import { Errors } from '@/core/errors/app-error';
import { prisma } from '@/infra/db/prisma';
import { balance, type Account } from './booking-ledger';

/** Money trail of one booking: every ledger entry plus the net balance per account (escrow must be 0 once settled). */
export async function adminBookingLedger(actor: Actor, bookingId: string) {
  requireRole(actor, 'ADMIN');
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true, code: true, status: true, totalPaise: true } });
  if (!booking) throw Errors.notFound('Booking');
  const rows = await prisma.ledgerEntry.findMany({ where: { bookingId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const lines = rows.map((r) => ({ debit: r.debitAccount as Account, credit: r.creditAccount as Account, amountPaise: r.amountPaise, memo: r.memo }));
  const accounts: Account[] = ['GUEST', 'PLATFORM_ESCROW', 'OWNER_PAYABLE', 'PLATFORM_REVENUE', 'TAX_PAYABLE', 'REFUND_PAYABLE'];
  return {
    bookingId: booking.id, code: booking.code, status: booking.status, totalPaise: booking.totalPaise,
    entries: rows.map((r) => ({ id: r.id, groupId: r.groupId, from: r.debitAccount, to: r.creditAccount, amountPaise: r.amountPaise, memo: r.memo, createdAt: r.createdAt.toISOString() })),
    balances: Object.fromEntries(accounts.map((a) => [a, balance(lines, a)])) as Record<Account, number>,
  };
}
