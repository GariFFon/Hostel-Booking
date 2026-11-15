import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { depositsService } from '@/modules/tenancies/deposits.service';
import { attachProofSchema, disputeSettlementSchema, recordPayoutSchema, resolveSettlementSchema, saveSettlementSchema } from '@/modules/tenancies/deposits.schema';

export const DELETE = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await depositsService.removeProof(actor, idParam(ctx), ctx.params.proofId ?? ''), { requestId: ctx.requestId });
});
