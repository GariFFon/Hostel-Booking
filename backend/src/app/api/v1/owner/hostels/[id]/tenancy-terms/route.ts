import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery, slugParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { termsService } from '@/modules/tenancies/terms.service';
import { updateTenancyTermsDefaultsSchema } from '@/modules/tenancies/tenancy.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await termsService.ownerTerms(actor, idParam(ctx)), { requestId: ctx.requestId });
});

export const PATCH = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const input = await parseJson(ctx.req, updateTenancyTermsDefaultsSchema);
  return ok(await termsService.updateOwnerTerms(actor, idParam(ctx), input), { requestId: ctx.requestId });
});
