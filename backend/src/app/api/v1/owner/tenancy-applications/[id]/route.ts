import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery, slugParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { applicationsService } from '@/modules/tenancies/applications.service';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await applicationsService.ownerGet(actor, idParam(ctx)), { requestId: ctx.requestId });
});
