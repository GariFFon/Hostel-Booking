import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { rentService } from '@/modules/rent/rent.service';
import { rentRollQuerySchema } from '@/modules/rent/rent.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await rentService.rentRoll(actor, parseQuery(ctx.req, rentRollQuerySchema)), { requestId: ctx.requestId });
});
