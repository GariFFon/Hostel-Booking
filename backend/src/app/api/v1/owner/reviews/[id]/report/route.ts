import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { reviewsOwnerService } from '@/modules/reviews/reviews-owner.service';
import { ownerReviewsQuerySchema, reasonSchema, replyReviewSchema } from '@/modules/reviews/reviews.schema';
import { rateLimit } from '@/core/rate-limit/rate-limit';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await rateLimit({ bucket: `review-report:day:${actor.id}`, limit: 20, windowSeconds: 86400 });
  const { reason } = await parseJson(ctx.req, reasonSchema);
  return ok(await reviewsOwnerService.report(actor, idParam(ctx), reason), meta);
});
