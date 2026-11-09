import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { reviewsOwnerService } from '@/modules/reviews/reviews-owner.service';
import { ownerReviewsQuerySchema, reasonSchema, replyReviewSchema } from '@/modules/reviews/reviews.schema';
import { rateLimit } from '@/core/rate-limit/rate-limit';

export const PUT = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await rateLimit({ bucket: `review-reply:${actor.id}`, limit: 60, windowSeconds: 3600 });
  const { text } = await parseJson(ctx.req, replyReviewSchema);
  return ok(await reviewsOwnerService.reply(actor, idParam(ctx), text), meta);
});

export const DELETE = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  return ok(await reviewsOwnerService.removeReply(actor, idParam(ctx)), meta);
});
