import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery, slugParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { tenanciesService } from '@/modules/tenancies/tenancies.service';
import { cancelTenancySchema } from '@/modules/tenancies/tenancy.schema';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const input = await parseJson(ctx.req, cancelTenancySchema);
  return ok(await tenanciesService.cancel(actor, idParam(ctx), input.reason), { requestId: ctx.requestId });
});
