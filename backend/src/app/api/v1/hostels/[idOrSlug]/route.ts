import { wrap } from '@/core/http/wrap';
import { slugParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { publicHostelsService } from '@/modules/hostels/public-hostels.service';

export const GET = wrap(async (ctx) => {
  const { dto, hit } = await publicHostelsService.get(slugParam(ctx));
  return ok(dto, { requestId: ctx.requestId }, 200, { 'X-Cache': hit ? 'HIT' : 'MISS' });
});
