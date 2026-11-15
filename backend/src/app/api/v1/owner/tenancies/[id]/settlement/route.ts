import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { depositsService } from '@/modules/tenancies/deposits.service';
import { attachProofSchema, disputeSettlementSchema, recordPayoutSchema, resolveSettlementSchema, saveSettlementSchema } from '@/modules/tenancies/deposits.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await depositsService.ownerGet(actor, idParam(ctx)), { requestId: ctx.requestId });
});

/** Saves the itemised deductions (replacing the old list). */
export const PUT = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const input = await parseJson(ctx.req, saveSettlementSchema);
  return ok(await depositsService.save(actor, idParam(ctx), input), { requestId: ctx.requestId });
});
