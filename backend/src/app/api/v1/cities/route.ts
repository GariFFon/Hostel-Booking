import { wrap } from '@/core/http/wrap';
import { ok } from '@/core/http/response';
import { searchService } from '@/modules/search/search.service';

export const GET = wrap(async (ctx) => {
  const { value, hit } = await searchService.cities();
  return ok(value, { requestId: ctx.requestId }, 200, { 'X-Cache': hit ? 'HIT' : 'MISS' });
});
