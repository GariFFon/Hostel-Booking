/**
 * Pure money movement. Every entry is "from -> to": `debit` is the account the money leaves, `credit` the one it
 * enters, so an account's balance is (sum of credits - sum of debits). PLATFORM_ESCROW holds guest money between
 * capture and settlement and must return to exactly zero for every booking.
 *
 *   capture      GUEST            -> ESCROW          total paid
 *   settlement   ESCROW           -> OWNER_PAYABLE   room revenue less commission     (on completion or no-show)
 *                ESCROW           -> PLATFORM_REVENUE commission
 *                ESCROW           -> TAX_PAYABLE     GST collected
 *   cancellation ESCROW           -> REFUND_PAYABLE  refund; the rest is split like a settlement
 *   refund paid  REFUND_PAYABLE   -> GUEST
 */
export type Account = 'GUEST' | 'PLATFORM_ESCROW' | 'PLATFORM_REVENUE' | 'OWNER_PAYABLE' | 'TAX_PAYABLE' | 'REFUND_PAYABLE';

export interface LedgerLine {
  debit: Account;
  credit: Account;
  amountPaise: number;
  memo: string;
}

export interface BookingMoney {
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  commissionBps: number;
  /** True when a platform-wide coupon paid for the discount (the owner is not out of pocket for it). */
  platformFundedDiscount: boolean;
}

const commission = (netPaise: number, bps: number) => Math.round((netPaise * bps) / 10_000);
const positive = (lines: LedgerLine[]) => lines.filter((l) => l.amountPaise > 0);

export const captureEntries = (totalPaise: number): LedgerLine[] =>
  positive([{ debit: 'GUEST', credit: 'PLATFORM_ESCROW', amountPaise: totalPaise, memo: 'Guest payment captured' }]);

/** Releases escrow when the stay is over (or the guest never showed and the amount is retained in full). */
export function settlementEntries(m: BookingMoney): LedgerLine[] {
  if (m.platformFundedDiscount) {
    // Guest paid (subtotal - discount + tax); the platform tops escrow up by the discount so the owner earns on the full subtotal.
    const c = commission(m.subtotalPaise, m.commissionBps);
    return positive([
      { debit: 'PLATFORM_REVENUE', credit: 'PLATFORM_ESCROW', amountPaise: m.discountPaise, memo: 'Platform-funded coupon' },
      { debit: 'PLATFORM_ESCROW', credit: 'OWNER_PAYABLE', amountPaise: m.subtotalPaise - c, memo: 'Owner share' },
      { debit: 'PLATFORM_ESCROW', credit: 'PLATFORM_REVENUE', amountPaise: c, memo: 'Platform commission' },
      { debit: 'PLATFORM_ESCROW', credit: 'TAX_PAYABLE', amountPaise: m.taxPaise, memo: 'GST collected' },
    ]);
  }
  const net = m.subtotalPaise - m.discountPaise;
  const c = commission(net, m.commissionBps);
  return positive([
    { debit: 'PLATFORM_ESCROW', credit: 'OWNER_PAYABLE', amountPaise: net - c, memo: 'Owner share' },
    { debit: 'PLATFORM_ESCROW', credit: 'PLATFORM_REVENUE', amountPaise: c, memo: 'Platform commission' },
    { debit: 'PLATFORM_ESCROW', credit: 'TAX_PAYABLE', amountPaise: m.taxPaise, memo: 'GST collected' },
  ]);
}

/** Cancellation of a paid booking: refund what the policy allows and settle the retained part. */
export function cancellationEntries(m: Pick<BookingMoney, 'totalPaise' | 'taxPaise' | 'commissionBps'>, refundPaise: number): LedgerLine[] {
  const retained = m.totalPaise - refundPaise;
  const taxRetained = m.totalPaise > 0 ? Math.round((m.taxPaise * retained) / m.totalPaise) : 0;
  const net = retained - taxRetained;
  const c = commission(net, m.commissionBps);
  return positive([
    { debit: 'PLATFORM_ESCROW', credit: 'REFUND_PAYABLE', amountPaise: refundPaise, memo: 'Refund to guest' },
    { debit: 'PLATFORM_ESCROW', credit: 'TAX_PAYABLE', amountPaise: taxRetained, memo: 'GST on retained amount' },
    { debit: 'PLATFORM_ESCROW', credit: 'PLATFORM_REVENUE', amountPaise: c, memo: 'Commission on retained amount' },
    { debit: 'PLATFORM_ESCROW', credit: 'OWNER_PAYABLE', amountPaise: net - c, memo: 'Owner share of retained amount' },
  ]);
}

/** Refund obligation arising without a cancellation (late payment after expiry, duplicate payment). */
export const fullRefundEntries = (amountPaise: number): LedgerLine[] =>
  positive([{ debit: 'PLATFORM_ESCROW', credit: 'REFUND_PAYABLE', amountPaise, memo: 'Refund to guest' }]);

export const refundPaidEntries = (amountPaise: number): LedgerLine[] =>
  positive([{ debit: 'REFUND_PAYABLE', credit: 'GUEST', amountPaise, memo: 'Refund paid to guest' }]);

export const refundAmount = (totalPaise: number, percent: number) => Math.floor((totalPaise * percent) / 100);

/** Balance of an account over a set of lines: credits minus debits. */
export function balance(lines: LedgerLine[], account: Account): number {
  return lines.reduce((s, l) => s + (l.credit === account ? l.amountPaise : 0) - (l.debit === account ? l.amountPaise : 0), 0);
}
