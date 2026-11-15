import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { rentService } from '@/modules/rent/rent.service';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await rentService.ownerGet(actor, idParam(ctx)), { requestId: ctx.requestId });
});
