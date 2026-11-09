import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { amenitiesService } from '@/modules/amenities/amenities.service';
import { createAmenitySchema, updateAmenitySchema } from '@/modules/amenities/amenities.schema';

export const PATCH = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const input = await parseJson(ctx.req, updateAmenitySchema);
  return ok(await amenitiesService.update(actor, idParam(ctx), input), meta);
});

export const DELETE = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await amenitiesService.remove(actor, idParam(ctx));
  return ok({ deleted: true }, meta);
});
