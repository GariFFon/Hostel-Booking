import { wrap } from '@/core/http/wrap';
import { slugParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { couponsService } from '@/modules/coupons/coupons.service';
import { rateLimit } from '@/core/rate-limit/rate-limit';

export const GET = wrap(async (ctx) => {
  await rateLimit({ bucket: `offers:ip:${ctx.ip}`, limit: 120, windowSeconds: 60 });
  const { offers, hit } = await couponsService.offers(slugParam(ctx));
  return ok(offers, { requestId: ctx.requestId }, 200, { 'X-Cache': hit ? 'HIT' : 'MISS' });
});
