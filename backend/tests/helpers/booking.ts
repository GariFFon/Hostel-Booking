import { addDays } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { balance, type Account } from '@/modules/bookings/booking-ledger';
import { POST as createBooking } from '@/app/api/v1/bookings/route';
import { POST as initiatePayment } from '@/app/api/v1/bookings/[id]/payments/route';
import { POST as demoCheckout } from '@/app/api/v1/payments/[id]/demo-checkout/route';
import { call } from './http';
import { D, TODAY, publish, uniq, type HostelSpec } from './publish';
import { makeUser } from './users';

let n = 0;
export const idemKey = () => `test-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

export const STAY = { checkIn: addDays(TODAY, 20), checkOut: addDays(TODAY, 22) };

export async function makeHost(spec: HostelSpec = {}) {
  const owner = await makeUser({ roles: ['OWNER', 'GUEST'], kyc: 'APPROVED' });
  const pub = await publish({ ownerId: owner.id, ...spec });
  return { owner, hostel: pub.hostel, rooms: pub.rooms };
}

export const makeGuest = (over: { verified?: boolean; name?: string } = {}) => makeUser({ roles: ['GUEST'], ...over });

export function bookingBody(hostelId: string, roomTypeId: string, over: Record<string, unknown> = {}) {
  return {
    hostelId, ...STAY, items: [{ roomTypeId, units: 1 }], guests: [{ fullName: 'Asha Rao', gender: 'FEMALE', age: 28 }], contactPhone: '+919876543210', ...over,
  } as Record<string, unknown>;
}

export const book = (token: string, body: Record<string, unknown>, key = idemKey()) => call(createBooking, { token, body, headers: { 'idempotency-key': key } });

/** Starts payment and "pays" with the given demo instrument. In inline queue mode the signed webhook is processed before this returns. */
export async function pay(token: string, bookingId: string, instrument: 'DEMO_SUCCESS' | 'DEMO_FAIL' | 'DEMO_PENDING' | 'DEMO_TIMEOUT' = 'DEMO_SUCCESS') {
  const init = await call(initiatePayment, { token, params: { id: bookingId } });
  if (init.status !== 201) return { init, checkout: init, paymentId: undefined as string | undefined };
  const paymentId = init.body.data.id as string;
  const checkout = await call(demoCheckout, { token, params: { id: paymentId }, body: { instrument, method: 'UPI' } });
  return { init, checkout, paymentId };
}

/** Books and pays in one go; returns the confirmed booking id. */
export async function confirmedBooking(guestToken: string, hostelId: string, roomTypeId: string, over: Record<string, unknown> = {}) {
  const b = await book(guestToken, bookingBody(hostelId, roomTypeId, over));
  if (b.status !== 201) throw new Error(`booking failed: ${JSON.stringify(b.body)}`);
  const id = b.body.data.id as string;
  const p = await pay(guestToken, id);
  if (p.checkout.status !== 200) throw new Error(`payment failed: ${JSON.stringify(p.checkout.body)}`);
  return id;
}

export async function ledgerBalances(bookingId: string): Promise<Record<Account, number>> {
  const rows = await prisma.ledgerEntry.findMany({ where: { bookingId } });
  const lines = rows.map((r) => ({ debit: r.debitAccount as Account, credit: r.creditAccount as Account, amountPaise: r.amountPaise, memo: r.memo }));
  return Object.fromEntries((['GUEST', 'PLATFORM_ESCROW', 'OWNER_PAYABLE', 'PLATFORM_REVENUE', 'TAX_PAYABLE', 'REFUND_PAYABLE'] as Account[]).map((a) => [a, balance(lines, a)])) as Record<Account, number>;
}

export async function inventoryOf(roomTypeId: string, from = STAY.checkIn, to = STAY.checkOut) {
  const rows = await prisma.inventoryNight.findMany({ where: { roomTypeId, date: { gte: D(from), lt: D(to) } } });
  return { held: rows.map((r) => r.heldUnits), booked: rows.map((r) => r.bookedUnits), blocked: rows.map((r) => r.blockedUnits), total: rows.map((r) => r.totalUnits) };
}

export const outboxTo = async (email: string) => (await import('@/infra/mail/mailer')).outbox.filter((m) => m.to === email);
export const notificationsFor = (userId: string) => prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
export { uniq };
