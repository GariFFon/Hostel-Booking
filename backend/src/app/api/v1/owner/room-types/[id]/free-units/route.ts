import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { unitsService } from '@/modules/units/units.service';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await unitsService.listFree(actor, idParam(ctx)), { requestId: ctx.requestId });
});
