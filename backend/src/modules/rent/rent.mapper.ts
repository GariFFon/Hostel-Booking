import type { Prisma } from '@/generated/prisma/client';
import { toDateString, todayIn } from '@/core/dates';
import { DEMO_INSTRUMENTS } from '@/infra/payments/demo.provider';
import { balanceOf, overdueDays } from './rent.rules';

const personSelect = { select: { id: true, email: true, profile: { select: { fullName: true, phone: true } } } } as const;

export const invoiceInclude = {
  lines: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' }, include: { refunds: { orderBy: { createdAt: 'asc' } } } },
  tenancy: { select: { id: true, code: true, graceDays: true, unit: { select: { label: true } } } },
  hostel: { select: { id: true, name: true, city: true, timezone: true } },
  tenant: personSelect,
  orders: { where: { status: { in: ['CREATED', 'PENDING'] } }, orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.RentInvoiceInclude;

export type InvoiceFull = Prisma.RentInvoiceGetPayload<{ include: typeof invoiceInclude }>;
export type Viewer = 'TENANT' | 'OWNER' | 'ADMIN';

const OPEN = ['CREATED', 'PENDING'] as const;

/** What can still be returned on an online payment: what it took, less what was refunded and what is already on its way back. */
export const refundableOf = (p: { amountPaise: number; refundedPaise: number; refunds: { status: string; amountPaise: number }[] }) =>
  Math.max(p.amountPaise - p.refundedPaise - p.refunds.filter((r) => r.status === 'PENDING').reduce((n, r) => n + r.amountPaise, 0), 0);

export function toInvoiceDto(i: InvoiceFull, viewer: Viewer, now = new Date()) {
  const today = todayIn(i.hostel.timezone, now);
  const dueDate = toDateString(i.dueDate);
  const balancePaise = balanceOf(i);
  const days = overdueDays({ status: i.status, dueDate, totalPaise: i.totalPaise, paidPaise: i.paidPaise }, i.tenancy.graceDays, today);
  const open = i.orders[0] && (OPEN as readonly string[]).includes(i.orders[0].status) ? i.orders[0] : null;
  const payable = (i.status === 'DUE' || i.status === 'PARTIALLY_PAID') && balancePaise > 0;
  const actions: ('pay' | 'record_payment' | 'add_line' | 'void')[] = [];
  if (viewer === 'TENANT' && payable) actions.push('pay');
  if (viewer === 'OWNER' && payable && !open) actions.push('record_payment', 'add_line');
  if (viewer === 'OWNER' && i.status === 'DUE' && i.paidPaise === 0 && !open) actions.push('void');
  return {
    id: i.id, number: i.number, status: i.status,
    hostel: { id: i.hostel.id, name: i.hostel.name, city: i.hostel.city },
    tenancy: { id: i.tenancy.id, code: i.tenancy.code, unitLabel: i.tenancy.unit.label },
    tenant: { id: i.tenant.id, name: i.tenant.profile?.fullName ?? null, email: i.tenant.email, phone: i.tenant.profile?.phone ?? null },
    periodStart: toDateString(i.periodStart), periodEnd: toDateString(i.periodEnd), dueDate,
    lines: i.lines.map((l) => ({ id: l.id, type: l.type, description: l.description, amountPaise: l.amountPaise })),
    subtotalPaise: i.subtotalPaise, taxPaise: i.taxPaise, gstRateBps: i.gstRateBps, totalPaise: i.totalPaise, paidPaise: i.paidPaise, balancePaise,
    overdue: { isOverdue: days > 0, days },
    payments: i.payments.map((p) => ({
      id: p.id, receiptNo: p.receiptNo, amountPaise: p.amountPaise, method: p.method, reference: p.reference, receivedOn: toDateString(p.receivedOn),
      reversed: p.reversedAt !== null, reverseReason: p.reverseReason, createdAt: p.createdAt.toISOString(),
      canReverse: viewer === 'OWNER' && p.method !== 'ONLINE' && p.method !== 'DEPOSIT' && p.reversedAt === null,
      refundedPaise: p.refundedPaise,
      refundablePaise: refundableOf(p),
      canRefund: viewer !== 'TENANT' && p.method === 'ONLINE' && p.reversedAt === null && refundableOf(p) > 0,
      refunds: p.refunds.map((r) => ({ id: r.id, amountPaise: r.amountPaise, status: r.status, reason: r.reason, byRole: r.initiatedByRole, createdAt: r.createdAt.toISOString(), processedAt: r.processedAt?.toISOString() ?? null })),
    })),
    openOrder: open ? { id: open.id, status: open.status as 'CREATED' | 'PENDING', amountPaise: open.amountPaise } : null,
    issuedAt: i.issuedAt.toISOString(), paidAt: i.paidAt?.toISOString() ?? null, voidReason: i.voidReason, version: i.version, actions,
  };
}

export const rentOrderInclude = { attempts: { orderBy: { createdAt: 'asc' } } } satisfies Prisma.RentOrderInclude;
export type RentOrderFull = Prisma.RentOrderGetPayload<{ include: typeof rentOrderInclude }>;

export function toRentOrderDto(o: RentOrderFull) {
  const open = o.status === 'CREATED' || o.status === 'PENDING';
  return {
    id: o.id, kind: o.invoiceId === null ? ('DEPOSIT' as const) : ('RENT' as const), invoiceId: o.invoiceId, tenancyId: o.tenancyId, provider: o.provider, amountPaise: o.amountPaise, currency: o.currency, status: o.status,
    method: o.method, failureCode: o.failureCode, failureReason: o.failureReason, capturedAt: o.capturedAt?.toISOString() ?? null,
    attempts: o.attempts.map((a) => ({ id: a.id, status: a.status, instrument: a.instrument, method: a.method, createdAt: a.createdAt.toISOString() })),
    checkout: open && o.provider === 'demo' ? { type: 'demo' as const, instruments: [...DEMO_INSTRUMENTS] } : null,
  };
}
