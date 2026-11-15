import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { rentService } from '@/modules/rent/rent.service';
import { ownerListInvoicesQuerySchema } from '@/modules/rent/rent.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const { items, nextCursor } = await rentService.ownerList(actor, parseQuery(ctx.req, ownerListInvoicesQuerySchema));
  return ok(items, { requestId: ctx.requestId, nextCursor });
});
