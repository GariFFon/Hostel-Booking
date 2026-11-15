import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { rentService } from '@/modules/rent/rent.service';
import { reversePaymentSchema } from '@/modules/rent/rent.schema';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const input = await parseJson(ctx.req, reversePaymentSchema);
  return ok(await rentService.reversePayment(actor, idParam(ctx), input.reason), { requestId: ctx.requestId });
});
