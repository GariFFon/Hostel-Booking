import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { reviewsService } from '@/modules/reviews/reviews.service';
import { createReviewSchema, publicReviewsQuerySchema, updateReviewSchema } from '@/modules/reviews/reviews.schema';
import { rateLimit } from '@/core/rate-limit/rate-limit';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await rateLimit({ bucket: `review:${actor.id}`, limit: 10, windowSeconds: 3600 });
  const input = await parseJson(ctx.req, createReviewSchema);
  return ok(await reviewsService.create(actor, idParam(ctx), input), meta, 201);
});
