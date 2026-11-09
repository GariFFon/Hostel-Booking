import { rateLimit } from '@/core/rate-limit/rate-limit';
import { wrap } from '@/core/http/wrap';
import { parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { mapQuerySchema } from '@/modules/search/search.schema';
import { searchService } from '@/modules/search/search.service';

export const GET = wrap(async (ctx) => {
  await rateLimit({ bucket: `search:ip:${ctx.ip}`, limit: 120, windowSeconds: 60 });
  const { value, hit } = await searchService.map(parseQuery(ctx.req, mapQuerySchema));
  return ok(value, { requestId: ctx.requestId }, 200, { 'X-Cache': hit ? 'HIT' : 'MISS' });
});
