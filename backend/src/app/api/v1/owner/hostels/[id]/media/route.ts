import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { mediaService } from '@/modules/media/media.service';
import { addMediaSchema, reorderMediaSchema, updateMediaSchema } from '@/modules/media/media.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  return ok(await mediaService.list(actor, idParam(ctx)), meta);
});

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const input = await parseJson(ctx.req, addMediaSchema);
  return ok(await mediaService.add(actor, idParam(ctx), input), meta, 201);
});
