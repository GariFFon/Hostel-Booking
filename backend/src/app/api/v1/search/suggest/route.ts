import { rateLimit } from '@/core/rate-limit/rate-limit';
import { wrap } from '@/core/http/wrap';
import { parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { suggestQuerySchema } from '@/modules/search/search.schema';
import { searchService } from '@/modules/search/search.service';

export const GET = wrap(async (ctx) => {
  await rateLimit({ bucket: `suggest:ip:${ctx.ip}`, limit: 180, windowSeconds: 60 });
  const { q } = parseQuery(ctx.req, suggestQuerySchema);
  const { value, hit } = await searchService.suggest(q);
  return ok(value, { requestId: ctx.requestId }, 200, { 'X-Cache': hit ? 'HIT' : 'MISS' });
});
