import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { kycService } from '@/modules/kyc/kyc.service';
import { addKycDocumentSchema, kycListQuerySchema, kycRejectSchema, updateOwnerProfileSchema } from '@/modules/kyc/kyc.schema';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const { reason } = await parseJson(ctx.req, kycRejectSchema);
  return ok(await kycService.adminDecide(actor, idParam(ctx, 'ownerId'), { approve: false, reason }), meta);
});
