import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery, slugParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { applicationsService } from '@/modules/tenancies/applications.service';
import { approveApplicationSchema } from '@/modules/tenancies/tenancy.schema';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const input = await parseJson(ctx.req, approveApplicationSchema);
  return ok(await applicationsService.approve(actor, idParam(ctx), input), { requestId: ctx.requestId });
});
