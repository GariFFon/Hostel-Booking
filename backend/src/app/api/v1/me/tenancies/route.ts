import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery, slugParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { tenanciesService } from '@/modules/tenancies/tenancies.service';
import { listTenanciesQuerySchema } from '@/modules/tenancies/tenancy.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const { items, nextCursor } = await tenanciesService.listMine(actor, parseQuery(ctx.req, listTenanciesQuerySchema));
  return ok(items, { requestId: ctx.requestId, nextCursor });
});
