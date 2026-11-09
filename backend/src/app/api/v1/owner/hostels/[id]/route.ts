import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { hostelsService } from '@/modules/hostels/hostels.service';
import { createHostelSchema, listOwnerHostelsQuerySchema, reasonSchema, updateHostelSchema } from '@/modules/hostels/hostels.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  return ok(await hostelsService.get(actor, idParam(ctx)), meta);
});

export const PATCH = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const input = await parseJson(ctx.req, updateHostelSchema);
  return ok(await hostelsService.update(actor, idParam(ctx), input), meta);
});

export const DELETE = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await hostelsService.remove(actor, idParam(ctx));
  return ok({ deleted: true }, meta);
});
