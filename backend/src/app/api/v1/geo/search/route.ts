import { rateLimit } from '@/core/rate-limit/rate-limit';
import { wrap } from '@/core/http/wrap';
import { parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { geoSearchQuerySchema } from '@/modules/geo/geo.schema';
import { geoService } from '@/modules/geo/geo.service';

export const GET = wrap(async (ctx) => {
  await rateLimit({ bucket: `geo:ip:${ctx.ip}`, limit: 30, windowSeconds: 60 });
  const { q, limit } = parseQuery(ctx.req, geoSearchQuerySchema);
  const { value, hit } = await geoService.search(q, limit);
  return ok(value, { requestId: ctx.requestId }, 200, { 'X-Cache': hit ? 'HIT' : 'MISS' });
});
