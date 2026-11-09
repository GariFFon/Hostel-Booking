import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { reviewsModerationService } from '@/modules/reviews/reviews-moderation.service';
import { adminReviewsQuerySchema, reasonSchema } from '@/modules/reviews/reviews.schema';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const { reason } = await parseJson(ctx.req, reasonSchema);
  return ok(await reviewsModerationService.hide(actor, idParam(ctx), reason), meta);
});
