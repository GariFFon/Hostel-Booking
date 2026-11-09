import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { kycService } from '@/modules/kyc/kyc.service';
import { addKycDocumentSchema, kycListQuerySchema, kycRejectSchema, updateOwnerProfileSchema } from '@/modules/kyc/kyc.schema';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const input = await parseJson(ctx.req, addKycDocumentSchema);
  return ok(await kycService.addDocument(actor, input), meta, 201);
});
