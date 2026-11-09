import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { reviewsService } from '@/modules/reviews/reviews.service';
import { paginationSchema } from '@/core/http/pagination';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const q = parseQuery(ctx.req, paginationSchema);
  const { items, nextCursor } = await reviewsService.listMine(actor, q);
  return ok(items, { ...meta, nextCursor });
});
