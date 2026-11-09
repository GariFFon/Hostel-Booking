import { wrap } from '@/core/http/wrap';
import { ok } from '@/core/http/response';
import { amenitiesService } from '@/modules/amenities/amenities.service';

export const GET = wrap(async (ctx) => {
  const meta = { requestId: ctx.requestId };
  return ok(await amenitiesService.list(), meta);
});
