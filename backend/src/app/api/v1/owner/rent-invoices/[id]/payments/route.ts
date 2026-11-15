import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { rentService } from '@/modules/rent/rent.service';
import { recordPaymentSchema } from '@/modules/rent/rent.schema';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const input = await parseJson(ctx.req, recordPaymentSchema);
  return ok(await rentService.recordPayment(actor, idParam(ctx), input), { requestId: ctx.requestId }, 201);
});
