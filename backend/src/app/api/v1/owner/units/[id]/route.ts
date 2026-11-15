import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { unitsService } from '@/modules/units/units.service';
import { updateUnitSchema } from '@/modules/units/units.schema';

export const PATCH = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const input = await parseJson(ctx.req, updateUnitSchema);
  return ok(await unitsService.update(actor, idParam(ctx), input), meta);
});

export const DELETE = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await unitsService.remove(actor, idParam(ctx));
  return ok({ deleted: true }, meta);
});
