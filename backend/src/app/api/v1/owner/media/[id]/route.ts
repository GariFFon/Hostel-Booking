import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { mediaService } from '@/modules/media/media.service';
import { addMediaSchema, reorderMediaSchema, updateMediaSchema } from '@/modules/media/media.schema';

export const PATCH = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const input = await parseJson(ctx.req, updateMediaSchema);
  return ok(await mediaService.update(actor, idParam(ctx), input), meta);
});

export const DELETE = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await mediaService.remove(actor, idParam(ctx));
  return ok({ deleted: true }, meta);
});
