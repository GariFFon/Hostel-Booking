import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { kycService } from '@/modules/kyc/kyc.service';
import { addKycDocumentSchema, kycListQuerySchema, kycRejectSchema, updateOwnerProfileSchema } from '@/modules/kyc/kyc.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  return ok(await kycService.get(actor), meta);
});

export const PATCH = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const input = await parseJson(ctx.req, updateOwnerProfileSchema);
  return ok(await kycService.updateProfile(actor, input), meta);
});
