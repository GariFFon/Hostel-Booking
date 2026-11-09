import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { mediaService } from '@/modules/media/media.service';
import { addMediaSchema, reorderMediaSchema, updateMediaSchema } from '@/modules/media/media.schema';

export const PUT = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const { ids } = await parseJson(ctx.req, reorderMediaSchema);
  return ok(await mediaService.reorder(actor, idParam(ctx), ids), meta);
});
