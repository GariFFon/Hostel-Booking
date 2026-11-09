/**
 * Pure pricing. No I/O, no clocks, all money in integer paise.
 *   nightly unit price = highest-priority applicable rule, else base price
 *   subtotal           = sum(units x unit price) over every room-night
 *   discount           = coupon, allocated across room-nights proportionally (largest remainder)
 *   tax                = per room-night: (amount - allocated discount) x GST rate, where the rate is chosen by the
 *                        declared (pre-discount) tariff of that room-night
 *   total              = subtotal - discount + tax            (service fee is 0 in v1)
 */
export const MIN_PRICE_PAISE = 100;
const DAYS_PER_MONTH = 30; // monthly (PG) rents are prorated per night

export interface PriceRuleInput {
  id: string;
  type: 'WEEKEND' | 'DATE_RANGE';
  weekdays: number[];
  startDate: string | null;
  endDate: string | null;
  pricePaise: number | null;
  adjustmentBps: number | null;
  priority: number;
  isActive: boolean;
}

export interface RoomPricingInput {
  basePricePaise: number;
  priceUnit: 'NIGHT' | 'MONTH';
  rules: PriceRuleInput[];
}

export interface TaxPolicy {
  lowBps: number;
  highBps: number;
  /** Per-night, per-unit tariff at or below which the low rate applies. */
  thresholdPaise: number;
}

const weekdayOf = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay();

function applies(rule: PriceRuleInput, date: string): boolean {
  if (!rule.isActive) return false;
  if (rule.type === 'WEEKEND') return rule.weekdays.includes(weekdayOf(date));
  return rule.startDate !== null && rule.endDate !== null && date >= rule.startDate && date <= rule.endDate;
}

/** Deterministic precedence: priority, then date-range over weekday rules, then id. Rules never stack. */
function byPrecedence(a: PriceRuleInput, b: PriceRuleInput): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.type !== b.type) return a.type === 'DATE_RANGE' ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

export function nightlyUnitPrice(room: RoomPricingInput, date: string): { unitPricePaise: number; ruleId: string | null } {
  const perNight = (amount: number) => (room.priceUnit === 'MONTH' ? Math.round(amount / DAYS_PER_MONTH) : amount);
  const rule = room.rules.filter((r) => applies(r, date)).sort(byPrecedence)[0];
  let price: number;
  if (!rule) price = perNight(room.basePricePaise);
  else if (rule.pricePaise !== null) price = perNight(rule.pricePaise);
  else price = Math.round(perNight(room.basePricePaise) * (1 + (rule.adjustmentBps ?? 0) / 10_000));
  return { unitPricePaise: Math.max(MIN_PRICE_PAISE, price), ruleId: rule?.id ?? null };
}

/** Splits `total` across `weights` in proportion, with no paise lost or invented (largest remainder). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map(Math.floor);
  let remainder = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i]! += 1;
    remainder -= 1;
  }
  return out;
}

export interface StayLineInput {
  roomTypeId: string;
  name: string;
  units: number;
  room: RoomPricingInput;
}

export interface NightPrice {
  date: string;
  unitPricePaise: number;
  ruleId: string | null;
  taxBps: number;
}

export interface PricedLine {
  roomTypeId: string;
  name: string;
  units: number;
  nightly: NightPrice[];
  lineSubtotalPaise: number;
}

export interface StayPrice {
  lines: PricedLine[];
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  /** tax / (subtotal - discount), for display and for the booking snapshot. */
  effectiveGstBps: number;
}

export function taxBpsFor(unitPricePaise: number, tax: TaxPolicy): number {
  return unitPricePaise <= tax.thresholdPaise ? tax.lowBps : tax.highBps;
}

export function priceStay(input: { nights: string[]; lines: StayLineInput[]; tax: TaxPolicy; discountPaise?: number }): StayPrice {
  const lines: PricedLine[] = input.lines.map((l) => {
    const nightly = input.nights.map((date) => {
      const { unitPricePaise, ruleId } = nightlyUnitPrice(l.room, date);
      return { date, unitPricePaise, ruleId, taxBps: taxBpsFor(unitPricePaise, input.tax) };
    });
    return { roomTypeId: l.roomTypeId, name: l.name, units: l.units, nightly, lineSubtotalPaise: nightly.reduce((s, n) => s + n.unitPricePaise * l.units, 0) };
  });

  const cells = lines.flatMap((l) => l.nightly.map((n) => ({ amount: n.unitPricePaise * l.units, bps: n.taxBps })));
  const subtotalPaise = cells.reduce((s, c) => s + c.amount, 0);
  const discountPaise = Math.min(Math.max(0, input.discountPaise ?? 0), subtotalPaise);
  const shares = allocate(discountPaise, cells.map((c) => c.amount));
  const taxPaise = cells.reduce((s, c, i) => s + Math.round(((c.amount - shares[i]!) * c.bps) / 10_000), 0);
  const taxable = subtotalPaise - discountPaise;

  return {
    lines, subtotalPaise, discountPaise, taxPaise,
    totalPaise: subtotalPaise - discountPaise + taxPaise,
    effectiveGstBps: taxable > 0 ? Math.round((taxPaise / taxable) * 10_000) : 0,
  };
}
