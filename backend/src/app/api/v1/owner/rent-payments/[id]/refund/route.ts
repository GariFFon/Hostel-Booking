import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { rentRefundsService } from '@/modules/rent/rent-refunds.service';
import { refundPaymentSchema } from '@/modules/rent/rent.schema';

/** Pays part or all of an online rent payment back to the tenant. */
export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const input = await parseJson(ctx.req, refundPaymentSchema);
  return ok(await rentRefundsService.create(actor, idParam(ctx), input, 'OWNER'), { requestId: ctx.requestId }, 201);
});
