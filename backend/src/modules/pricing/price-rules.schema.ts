import { z } from 'zod';
import { isDateString } from '@/core/dates';

const date = z.string().refine(isDateString, 'Use YYYY-MM-DD');

/** Default-free: reused for partial updates so omitted fields are never reset. */
const fields = z.object({
  type: z.enum(['WEEKEND', 'DATE_RANGE']),
  name: z.string().trim().max(80).nullish(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  startDate: date.nullish(),
  endDate: date.nullish(),
  pricePaise: z.number().int().min(100).max(10_000_000).nullish(),
  adjustmentBps: z.number().int().min(-9000).max(50000).nullish(),
  priority: z.number().int().min(0).max(100),
  isActive: z.boolean(),
});

export type PriceRuleShape = z.infer<typeof fields>;

/** Cross-field rules, shared by create and (merged) update. */
export function validatePriceRule(v: Pick<PriceRuleShape, 'type' | 'weekdays' | 'startDate' | 'endDate' | 'pricePaise' | 'adjustmentBps'>) {
  const issues: { path: string; message: string }[] = [];
  const hasPrice = v.pricePaise != null;
  const hasAdj = v.adjustmentBps != null;
  if (hasPrice === hasAdj) issues.push({ path: 'pricePaise', message: 'Provide exactly one of pricePaise or adjustmentBps' });
  if (v.type === 'WEEKEND') {
    if (v.weekdays.length === 0 || new Set(v.weekdays).size !== v.weekdays.length) issues.push({ path: 'weekdays', message: 'Choose one or more distinct weekdays (0=Sun..6=Sat)' });
    if (v.startDate || v.endDate) issues.push({ path: 'startDate', message: 'Weekday rules do not take dates' });
  } else {
    if (!v.startDate || !v.endDate) issues.push({ path: 'startDate', message: 'Date-range rules need startDate and endDate' });
    else if (v.endDate < v.startDate) issues.push({ path: 'endDate', message: 'endDate must not be before startDate' });
    if (v.weekdays.length) issues.push({ path: 'weekdays', message: 'Date-range rules do not take weekdays' });
  }
  return issues;
}

export const createPriceRuleSchema = fields
  .extend({ weekdays: fields.shape.weekdays.default([]), priority: fields.shape.priority.default(0), isActive: fields.shape.isActive.default(true) })
  .superRefine((v, ctx) => {
  for (const i of validatePriceRule(v)) ctx.addIssue({ code: 'custom', path: [i.path], message: i.message });
});
export const updatePriceRuleSchema = fields.omit({ type: true }).partial().strict().refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export type CreatePriceRuleInput = z.infer<typeof createPriceRuleSchema>;
export type UpdatePriceRuleInput = z.infer<typeof updatePriceRuleSchema>;
