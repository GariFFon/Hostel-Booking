import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery, slugParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { tenanciesService } from '@/modules/tenancies/tenancies.service';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await tenanciesService.accept(actor, idParam(ctx)), { requestId: ctx.requestId });
});
