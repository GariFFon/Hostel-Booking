import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { reviewsService } from '@/modules/reviews/reviews.service';
import { createReviewSchema, publicReviewsQuerySchema, updateReviewSchema } from '@/modules/reviews/reviews.schema';
import { rateLimit } from '@/core/rate-limit/rate-limit';

export const PATCH = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await rateLimit({ bucket: `review-edit:${actor.id}`, limit: 30, windowSeconds: 3600 });
  const patch = await parseJson(ctx.req, updateReviewSchema);
  return ok(await reviewsService.update(actor, idParam(ctx), patch), meta);
});

export const DELETE = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await rateLimit({ bucket: `review-edit:${actor.id}`, limit: 30, windowSeconds: 3600 });
  await reviewsService.remove(actor, idParam(ctx));
  return ok({ deleted: true }, meta);
});
