import { rateLimit } from '@/core/rate-limit/rate-limit';
import { wrap } from '@/core/http/wrap';
import { parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { geoReverseQuerySchema } from '@/modules/geo/geo.schema';
import { geoService } from '@/modules/geo/geo.service';

export const GET = wrap(async (ctx) => {
  await rateLimit({ bucket: `geo:ip:${ctx.ip}`, limit: 30, windowSeconds: 60 });
  const { lat, lng } = parseQuery(ctx.req, geoReverseQuerySchema);
  const { value, hit } = await geoService.reverse(lat, lng);
  return ok(value, { requestId: ctx.requestId }, 200, { 'X-Cache': hit ? 'HIT' : 'MISS' });
});
