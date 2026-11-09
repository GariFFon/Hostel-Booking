import { wrap } from '@/core/http/wrap';
import { slugParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { reviewsService } from '@/modules/reviews/reviews.service';
import { rateLimit } from '@/core/rate-limit/rate-limit';

export const GET = wrap(async (ctx) => {
  await rateLimit({ bucket: `reviews:ip:${ctx.ip}`, limit: 120, windowSeconds: 60 });
  const { dto, hit } = await reviewsService.summary(slugParam(ctx));
  return ok(dto, { requestId: ctx.requestId }, 200, { 'X-Cache': hit ? 'HIT' : 'MISS' });
});
