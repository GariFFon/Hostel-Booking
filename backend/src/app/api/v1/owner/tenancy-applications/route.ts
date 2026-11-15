import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery, slugParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { applicationsService } from '@/modules/tenancies/applications.service';
import { ownerListApplicationsQuerySchema } from '@/modules/tenancies/tenancy.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const { items, nextCursor } = await applicationsService.ownerList(actor, parseQuery(ctx.req, ownerListApplicationsQuerySchema));
  return ok(items, { requestId: ctx.requestId, nextCursor });
});
