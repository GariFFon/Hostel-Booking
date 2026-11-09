import { describe, expect, it } from 'vitest';
import { balance, cancellationEntries, captureEntries, fullRefundEntries, refundAmount, refundPaidEntries, settlementEntries, type BookingMoney, type LedgerLine } from '@/modules/bookings/booking-ledger';
import { TRANSITIONS, TERMINAL, assertTransition, canTransition, type BookingActor } from '@/modules/bookings/bookings.status';
import type { BookingStatus } from '@/generated/prisma/client';

const money = (over: Partial<BookingMoney> = {}): BookingMoney => ({ subtotalPaise: 544000, discountPaise: 0, taxPaise: 27200, totalPaise: 571200, commissionBps: 1000, platformFundedDiscount: false, ...over });
const all = (...parts: LedgerLine[][]) => parts.flat();

describe('ledger: normal stay', () => {
  it('capture + settlement leaves escrow at exactly zero and splits owner / platform / tax', () => {
    const m = money();
    const lines = all(captureEntries(m.totalPaise), settlementEntries(m));
    expect(balance(lines, 'PLATFORM_ESCROW')).toBe(0);
    expect(balance(lines, 'OWNER_PAYABLE')).toBe(489600); // 544000 - 10%
    expect(balance(lines, 'PLATFORM_REVENUE')).toBe(54400);
    expect(balance(lines, 'TAX_PAYABLE')).toBe(27200);
    expect(balance(lines, 'GUEST')).toBe(-571200);
  });

  it('owner-funded discount: commission is on the discounted revenue', () => {
    const m = money({ subtotalPaise: 544000, discountPaise: 50000, taxPaise: 24700, totalPaise: 518700 });
    const lines = all(captureEntries(m.totalPaise), settlementEntries(m));
    expect(balance(lines, 'PLATFORM_ESCROW')).toBe(0);
    expect(balance(lines, 'PLATFORM_REVENUE')).toBe(49400); // 10% of 494000
    expect(balance(lines, 'OWNER_PAYABLE')).toBe(444600);
  });

  it('platform-funded discount: the owner earns on the full subtotal and the platform absorbs the discount', () => {
    const m = money({ subtotalPaise: 544000, discountPaise: 50000, taxPaise: 24700, totalPaise: 518700, platformFundedDiscount: true });
    const lines = all(captureEntries(m.totalPaise), settlementEntries(m));
    expect(balance(lines, 'PLATFORM_ESCROW')).toBe(0);
    expect(balance(lines, 'OWNER_PAYABLE')).toBe(544000 - 54400);
    expect(balance(lines, 'PLATFORM_REVENUE')).toBe(54400 - 50000); // commission less the subsidy
    expect(balance(lines, 'TAX_PAYABLE')).toBe(24700);
  });

  it('a free booking (100% discount) creates no zero-amount entries', () => {
    const m = money({ subtotalPaise: 80000, discountPaise: 80000, taxPaise: 0, totalPaise: 0 });
    expect(captureEntries(0)).toEqual([]);
    expect(settlementEntries(m).every((l) => l.amountPaise > 0)).toBe(true);
  });
});

describe('ledger: cancellations and refunds', () => {
  it('full refund: everything goes back to the guest, nothing is retained', () => {
    const m = money();
    const lines = all(captureEntries(m.totalPaise), cancellationEntries(m, m.totalPaise), refundPaidEntries(m.totalPaise));
    expect(balance(lines, 'PLATFORM_ESCROW')).toBe(0);
    expect(balance(lines, 'REFUND_PAYABLE')).toBe(0);
    expect(balance(lines, 'GUEST')).toBe(0);
    expect(balance(lines, 'OWNER_PAYABLE') + balance(lines, 'PLATFORM_REVENUE') + balance(lines, 'TAX_PAYABLE')).toBe(0);
  });

  it('50% refund: the retained half is split into tax, commission and owner share', () => {
    const m = money();
    const refund = refundAmount(m.totalPaise, 50); // 285600
    const lines = all(captureEntries(m.totalPaise), cancellationEntries(m, refund), refundPaidEntries(refund));
    expect(balance(lines, 'PLATFORM_ESCROW')).toBe(0);
    expect(balance(lines, 'GUEST')).toBe(-(m.totalPaise - refund));
    expect(balance(lines, 'TAX_PAYABLE')).toBe(13600);
    expect(balance(lines, 'OWNER_PAYABLE') + balance(lines, 'PLATFORM_REVENUE')).toBe(272000);
    expect(balance(lines, 'PLATFORM_REVENUE')).toBe(27200);
  });

  it('no refund: the whole amount is retained and settled', () => {
    const m = money();
    const lines = all(captureEntries(m.totalPaise), cancellationEntries(m, 0));
    expect(balance(lines, 'PLATFORM_ESCROW')).toBe(0);
    expect(balance(lines, 'TAX_PAYABLE')).toBe(27200);
    expect(balance(lines, 'REFUND_PAYABLE')).toBe(0);
  });

  it('late-payment refund returns the exact amount captured', () => {
    const lines = all(captureEntries(123456), fullRefundEntries(123456), refundPaidEntries(123456));
    expect(['PLATFORM_ESCROW', 'REFUND_PAYABLE', 'GUEST'].map((a) => balance(lines, a as never))).toEqual([0, 0, 0]);
  });

  it('refund amounts round down (never refund more than owed)', () => {
    expect(refundAmount(571200, 50)).toBe(285600);
    expect(refundAmount(1001, 50)).toBe(500);
    expect(refundAmount(571200, 100)).toBe(571200);
    expect(refundAmount(571200, 0)).toBe(0);
  });

  it('escrow always returns to zero, for any amounts, rates and refund sizes', () => {
    for (let i = 0; i < 500; i++) {
      const subtotal = 1000 + ((i * 7919) % 3_000_000);
      const discount = (i * 104729) % Math.floor(subtotal / 2);
      const tax = Math.round(((subtotal - discount) * (i % 2 ? 500 : 1800)) / 10_000);
      const total = subtotal - discount + tax;
      const bps = (i * 37) % 3000;
      const m: BookingMoney = { subtotalPaise: subtotal, discountPaise: discount, taxPaise: tax, totalPaise: total, commissionBps: bps, platformFundedDiscount: i % 3 === 0 };
      const refund = refundAmount(total, [0, 50, 100][i % 3]!);
      const settled = all(captureEntries(total), settlementEntries(m));
      const cancelled = all(captureEntries(total), cancellationEntries(m, refund), refundPaidEntries(refund));
      expect(balance(settled, 'PLATFORM_ESCROW')).toBe(0);
      expect(balance(cancelled, 'PLATFORM_ESCROW')).toBe(0);
      expect(balance(cancelled, 'REFUND_PAYABLE')).toBe(0);
      expect([...settled, ...cancelled].every((l) => Number.isInteger(l.amountPaise) && l.amountPaise > 0 && l.debit !== l.credit)).toBe(true);
    }
  });
});

describe('booking state machine', () => {
  const states = Object.keys(TRANSITIONS) as BookingStatus[];

  it('terminal states have no exits, and every other state can eventually reach a terminal one', () => {
    for (const s of TERMINAL) expect(Object.keys(TRANSITIONS[s])).toEqual([]);
    for (const s of states.filter((x) => !TERMINAL.includes(x))) {
      const seen = new Set<BookingStatus>([s]);
      const stack = [s];
      while (stack.length) for (const n of Object.keys(TRANSITIONS[stack.pop()!]) as BookingStatus[]) if (!seen.has(n)) { seen.add(n); stack.push(n); }
      expect([...seen].some((x) => TERMINAL.includes(x))).toBe(true);
    }
  });

  it('only the system can confirm a booking (payment is the only way in) and guests cannot approve themselves', () => {
    expect(canTransition('PENDING_PAYMENT', 'CONFIRMED', 'SYSTEM')).toBe(true);
    for (const a of ['GUEST', 'OWNER', 'ADMIN'] as BookingActor[]) expect(canTransition('PENDING_PAYMENT', 'CONFIRMED', a)).toBe(false);
    expect(canTransition('PENDING_APPROVAL', 'PENDING_PAYMENT', 'GUEST')).toBe(false);
    expect(canTransition('PENDING_APPROVAL', 'PENDING_PAYMENT', 'OWNER')).toBe(true);
  });

  it('rejects impossible moves with distinct errors for "illegal" and "not yours"', () => {
    expect(() => assertTransition('COMPLETED', 'CONFIRMED', 'ADMIN')).toThrow(/Cannot move/);
    expect(() => assertTransition('CHECKED_IN', 'CANCELLED_BY_GUEST', 'GUEST')).toThrow(/Cannot move/);
    expect(() => assertTransition('CONFIRMED', 'CHECKED_IN', 'GUEST')).toThrow(/cannot move a booking/);
    expect(() => assertTransition('CONFIRMED', 'CHECKED_IN', 'OWNER')).not.toThrow();
  });
});

import { demoPaymentsAllowed } from '@/infra/payments/demo.provider';
describe('demo gateway safety', () => {
  it('is available in development/test/staging but refused in production unless explicitly enabled', () => {
    for (const APP_ENV of ['local', 'test', 'staging']) expect(demoPaymentsAllowed({ APP_ENV, ALLOW_DEMO_PAYMENTS: false })).toBe(true);
    expect(demoPaymentsAllowed({ APP_ENV: 'production', ALLOW_DEMO_PAYMENTS: false })).toBe(false);
    expect(demoPaymentsAllowed({ APP_ENV: 'production', ALLOW_DEMO_PAYMENTS: true })).toBe(true);
  });
});
