import { z } from 'zod';

const money = z.number().int().min(1, 'Enter an amount').max(100_000_000);
export const deductionTypeSchema = z.enum(['UNPAID_RENT', 'DAMAGE', 'CLEANING', 'UTILITIES', 'OTHER']);
export const settlementStatusSchema = z.enum(['DRAFT', 'PROPOSED', 'DISPUTED', 'AGREED', 'COMPLETED']);

export const deductionInputSchema = z.strictObject({
  type: deductionTypeSchema,
  description: z.string().trim().min(3, 'Say what this is for').max(200),
  amountPaise: money,
  /** Required for UNPAID_RENT (the invoice it settles) and not allowed for anything else. */
  invoiceId: z.uuid().optional(),
});

export const saveSettlementSchema = z.strictObject({ deductions: z.array(deductionInputSchema).max(30), note: z.string().trim().max(1000).optional() });
export const disputeSettlementSchema = z.strictObject({ note: z.string().trim().min(5, 'Tell the owner what is wrong').max(1000) });
export const recordPayoutSchema = z.strictObject({ method: z.enum(['CASH', 'UPI', 'BANK']), reference: z.string().trim().max(100).optional() });
export const resolveSettlementSchema = z.strictObject({ deductions: z.array(deductionInputSchema).max(30), note: z.string().trim().min(5, 'Explain the decision').max(1000) });
export const attachProofSchema = z.strictObject({ publicId: z.string().min(10).max(300) });

const ts = z.iso.datetime();
export const settlementDtoSchema = z.strictObject({
  id: z.uuid(), tenancyId: z.uuid(), status: settlementStatusSchema,
  tenant: z.strictObject({ id: z.uuid(), name: z.string().nullable() }), hostel: z.strictObject({ id: z.uuid(), name: z.string() }),
  depositPaise: z.number().int(), deductionsPaise: z.number().int(), refundPaise: z.number().int(),
  note: z.string().nullable(), disputeNote: z.string().nullable(),
  proposedAt: ts.nullable(), respondBy: ts.nullable(), respondedAt: ts.nullable(), agreedAt: ts.nullable(), autoAgreed: z.boolean(), completedAt: ts.nullable(),
  payout: z.strictObject({ online: z.boolean(), method: z.enum(['CASH', 'UPI', 'BANK', 'ONLINE', 'DEPOSIT']).nullable(), reference: z.string().nullable() }),
  deductions: z.array(z.strictObject({ id: z.uuid(), type: deductionTypeSchema, description: z.string(), amountPaise: z.number().int(), invoiceId: z.uuid().nullable() })),
  proofs: z.array(z.strictObject({ id: z.uuid(), url: z.string(), createdAt: ts })),
  /** Owner only, while the settlement can still be edited: invoices with money still owed, to pick unpaid rent from. */
  openInvoices: z.array(z.strictObject({ id: z.uuid(), number: z.string(), balancePaise: z.number().int() })),
  version: z.number().int(),
  actions: z.array(z.enum(['edit', 'add_proof', 'propose', 'retract', 'accept', 'dispute', 'record_payout', 'resolve'])),
});

export type DeductionInput = z.infer<typeof deductionInputSchema>;
export type SaveSettlementInput = z.infer<typeof saveSettlementSchema>;
