import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { reviewsModerationService } from '@/modules/reviews/reviews-moderation.service';
import { adminReviewsQuerySchema, reasonSchema } from '@/modules/reviews/reviews.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const q = parseQuery(ctx.req, adminReviewsQuerySchema);
  const { items, nextCursor } = await reviewsModerationService.list(actor, q);
  return ok(items, { ...meta, nextCursor });
});
