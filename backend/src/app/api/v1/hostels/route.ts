import { rateLimit } from '@/core/rate-limit/rate-limit';
import { wrap } from '@/core/http/wrap';
import { parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { searchQuerySchema } from '@/modules/search/search.schema';
import { searchService } from '@/modules/search/search.service';

export const GET = wrap(async (ctx) => {
  await rateLimit({ bucket: `search:ip:${ctx.ip}`, limit: 120, windowSeconds: 60 });
  const q = parseQuery(ctx.req, searchQuerySchema);
  const { value, hit } = await searchService.search(q);
  return ok(value.items, { requestId: ctx.requestId, nextCursor: value.nextCursor, ...(value.total !== null ? { total: value.total } : {}) }, 200, { 'X-Cache': hit ? 'HIT' : 'MISS' });
});
