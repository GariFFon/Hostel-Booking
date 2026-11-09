import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { amenitiesService } from '@/modules/amenities/amenities.service';
import { createAmenitySchema, updateAmenitySchema } from '@/modules/amenities/amenities.schema';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const input = await parseJson(ctx.req, createAmenitySchema);
  return ok(await amenitiesService.create(actor, input), meta, 201);
});
