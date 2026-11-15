import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery, slugParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { tenanciesService } from '@/modules/tenancies/tenancies.service';
import { updateTenancyTermsSchema } from '@/modules/tenancies/tenancy.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await tenanciesService.ownerGet(actor, idParam(ctx)), { requestId: ctx.requestId });
});

export const PATCH = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const input = await parseJson(ctx.req, updateTenancyTermsSchema);
  return ok(await tenanciesService.updateTerms(actor, idParam(ctx), input), { requestId: ctx.requestId });
});
