import { wrap } from '@/core/http/wrap';
import { parseQuery, slugParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { reviewsService } from '@/modules/reviews/reviews.service';
import { createReviewSchema, publicReviewsQuerySchema, updateReviewSchema } from '@/modules/reviews/reviews.schema';
import { rateLimit } from '@/core/rate-limit/rate-limit';

export const GET = wrap(async (ctx) => {
  await rateLimit({ bucket: `reviews:ip:${ctx.ip}`, limit: 120, windowSeconds: 60 });
  const q = parseQuery(ctx.req, publicReviewsQuerySchema);
  const { items, nextCursor, hit } = await reviewsService.listPublic(slugParam(ctx), q);
  return ok(items, { requestId: ctx.requestId, nextCursor }, 200, { 'X-Cache': hit ? 'HIT' : 'MISS' });
});
