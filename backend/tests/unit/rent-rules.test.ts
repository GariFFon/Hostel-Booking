import { describe, expect, it } from 'vitest';
import { DUE_SOON_DAYS, INVOICE_LEAD_DAYS, balanceOf, dueDateFor, invoiceAmounts, invoiceableOn, monthEnd, nextMonthStart, nextPeriod, newInvoiceNumber, newReceiptNumber, overdueDays } from '@/modules/rent/rent.rules';

const terms = (over: Partial<Parameters<typeof nextPeriod>[0]> = {}) => ({ billingFrom: '2027-03-01', rentPaise: 600000, dueDay: 5, endDate: null, ...over });

describe('calendar helpers', () => {
  it('knows month ends, leap years and the next month', () => {
    expect(monthEnd('2027-01-15')).toBe('2027-01-31');
    expect(monthEnd('2027-02-03')).toBe('2027-02-28');
    expect(monthEnd('2028-02-03')).toBe('2028-02-29');
    expect(monthEnd('2027-04-30')).toBe('2027-04-30');
    expect(nextMonthStart('2027-12-20')).toBe('2028-01-01');
    expect(nextMonthStart('2027-02-28')).toBe('2027-03-01');
  });

  it('clamps the due day to 1-28 so every month has one', () => {
    expect(dueDateFor('2027-02-01', 31)).toBe('2027-02-28');
    expect(dueDateFor('2027-02-01', 0)).toBe('2027-02-01');
    expect(dueDateFor('2027-05-01', 5)).toBe('2027-05-05');
  });
});

describe('the first period', () => {
  it('is a whole month when billing starts on the 1st, due on the due day', () => {
    expect(nextPeriod(terms(), null)).toEqual({ periodStart: '2027-03-01', periodEnd: '2027-03-31', dueDate: '2027-03-05', rentPaise: 600000, prorated: false });
  });

  it('is prorated by days when billing starts mid-month, and due at once', () => {
    // 11 of 31 days (21st to 31st)
    expect(nextPeriod(terms({ billingFrom: '2027-03-21' }), null)).toEqual({ periodStart: '2027-03-21', periodEnd: '2027-03-31', dueDate: '2027-03-21', rentPaise: Math.round((600000 * 11) / 31), prorated: true });
  });

  it('prorates by the real length of the month (February)', () => {
    expect(nextPeriod(terms({ billingFrom: '2027-02-15', rentPaise: 560000 }), null)!.rentPaise).toBe(Math.round((560000 * 14) / 28));
  });

  it('a single last day still bills one day', () => {
    expect(nextPeriod(terms({ billingFrom: '2027-03-31' }), null)).toMatchObject({ periodStart: '2027-03-31', periodEnd: '2027-03-31', rentPaise: Math.round(600000 / 31) });
  });
});

describe('later periods', () => {
  it('follow in calendar months, whole, due on the due day', () => {
    expect(nextPeriod(terms(), '2027-03-01')).toEqual({ periodStart: '2027-04-01', periodEnd: '2027-04-30', dueDate: '2027-04-05', rentPaise: 600000, prorated: false });
    expect(nextPeriod(terms(), '2027-12-01')!.periodStart).toBe('2028-01-01');
  });

  it('follow a prorated first period too', () => {
    expect(nextPeriod(terms({ billingFrom: '2027-03-21' }), '2027-03-21')!.periodStart).toBe('2027-04-01');
  });

  it('stop at the end date, prorating the last month', () => {
    const t = terms({ endDate: '2027-05-10' });
    expect(nextPeriod(t, '2027-04-01')).toEqual({ periodStart: '2027-05-01', periodEnd: '2027-05-10', dueDate: '2027-05-05', rentPaise: Math.round((600000 * 10) / 31), prorated: true });
    expect(nextPeriod(t, '2027-05-01')).toBeNull();
  });

  it('a stay that ended before billing began has nothing to bill', () => {
    expect(nextPeriod(terms({ endDate: '2027-02-28' }), null)).toBeNull();
  });
});

describe('when an invoice goes out', () => {
  it('a week ahead of the due date', () => {
    const plan = nextPeriod(terms(), '2027-03-01')!; // due 2027-04-05
    expect(INVOICE_LEAD_DAYS).toBe(7);
    expect(invoiceableOn(plan, '2027-03-28')).toBe(false);
    expect(invoiceableOn(plan, '2027-03-29')).toBe(true);
    expect(invoiceableOn(plan, '2027-04-20')).toBe(true);
  });

  it('a prorated first invoice goes out immediately', () => {
    expect(invoiceableOn(nextPeriod(terms({ billingFrom: '2027-03-21' }), null)!, '2027-03-21')).toBe(true);
  });

  it('reminders come before the lead time ends', () => {
    expect(DUE_SOON_DAYS).toBeLessThan(INVOICE_LEAD_DAYS);
  });
});

describe('invoice amounts', () => {
  it('adds the lines, and taxes only the rent', () => {
    const a = invoiceAmounts([{ type: 'RENT', amountPaise: 600000 }, { type: 'ELECTRICITY', amountPaise: 45000 }, { type: 'CREDIT', amountPaise: -10000 }], 1800);
    expect(a).toEqual({ subtotalPaise: 635000, taxPaise: 108000, totalPaise: 743000 });
  });

  it('has no tax at 0%', () => {
    expect(invoiceAmounts([{ type: 'RENT', amountPaise: 600000 }], 0)).toEqual({ subtotalPaise: 600000, taxPaise: 0, totalPaise: 600000 });
  });

  it('rounds tax to the nearest paisa', () => {
    expect(invoiceAmounts([{ type: 'RENT', amountPaise: 333 }], 500).taxPaise).toBe(17); // 16.65
  });

  it('a late fee is not rent', () => {
    expect(invoiceAmounts([{ type: 'RENT', amountPaise: 1000 }, { type: 'LATE_FEE', amountPaise: 5000 }], 1000).taxPaise).toBe(100);
  });
});

describe('overdue', () => {
  const inv = (over: Partial<Parameters<typeof overdueDays>[0]> = {}) => ({ status: 'DUE', dueDate: '2027-04-05', totalPaise: 600000, paidPaise: 0, ...over });

  it('counts days after the grace period, never before', () => {
    expect(overdueDays(inv(), 5, '2027-04-10')).toBe(0); // last day of grace
    expect(overdueDays(inv(), 5, '2027-04-11')).toBe(1);
    expect(overdueDays(inv(), 0, '2027-04-06')).toBe(1);
    expect(overdueDays(inv(), 5, '2027-04-01')).toBe(0);
  });

  it('only applies to something still owed', () => {
    expect(overdueDays(inv({ status: 'PAID', paidPaise: 600000 }), 0, '2027-06-01')).toBe(0);
    expect(overdueDays(inv({ status: 'VOID' }), 0, '2027-06-01')).toBe(0);
    expect(overdueDays(inv({ status: 'PARTIALLY_PAID', paidPaise: 100000 }), 0, '2027-04-08')).toBe(3);
  });

  it('balance never goes negative', () => {
    expect(balanceOf({ totalPaise: 100, paidPaise: 40 })).toBe(60);
    expect(balanceOf({ totalPaise: 100, paidPaise: 150 })).toBe(0);
  });
});

describe('document numbers', () => {
  it('read as INV-YYMM-XXXXXX / RCPT-YYMM-XXXXXX and do not repeat', () => {
    expect(newInvoiceNumber('2027-04-01')).toMatch(/^INV-2704-[A-HJ-NP-Z2-9]{6}$/);
    expect(newReceiptNumber('2027-12-31')).toMatch(/^RCPT-2712-[A-HJ-NP-Z2-9]{6}$/);
    expect(new Set(Array.from({ length: 200 }, () => newInvoiceNumber('2027-04-01'))).size).toBe(200);
  });
});
