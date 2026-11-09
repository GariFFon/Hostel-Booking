import { rateLimit } from '@/core/rate-limit/rate-limit';
import { wrap } from '@/core/http/wrap';
import { parseQuery, slugParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { publicHostelsService } from '@/modules/hostels/public-hostels.service';
import { availabilityQuerySchema } from '@/modules/search/search.schema';

export const GET = wrap(async (ctx) => {
  await rateLimit({ bucket: `avail:ip:${ctx.ip}`, limit: 120, windowSeconds: 60 });
  const q = parseQuery(ctx.req, availabilityQuerySchema);
  return ok(await publicHostelsService.availability(slugParam(ctx), q), { requestId: ctx.requestId });
});
