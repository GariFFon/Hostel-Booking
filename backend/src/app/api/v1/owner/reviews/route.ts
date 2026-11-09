import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { reviewsOwnerService } from '@/modules/reviews/reviews-owner.service';
import { ownerReviewsQuerySchema, reasonSchema, replyReviewSchema } from '@/modules/reviews/reviews.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const q = parseQuery(ctx.req, ownerReviewsQuerySchema);
  const { items, nextCursor } = await reviewsOwnerService.list(actor, q);
  return ok(items, { ...meta, nextCursor });
});
