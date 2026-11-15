import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { unitsService } from '@/modules/units/units.service';
import { createUnitsSchema } from '@/modules/units/units.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  return ok(await unitsService.list(actor, idParam(ctx)), meta);
});

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const input = await parseJson(ctx.req, createUnitsSchema);
  return ok(await unitsService.create(actor, idParam(ctx), input), meta, 201);
});
