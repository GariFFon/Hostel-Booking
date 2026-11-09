import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { paymentsService } from '@/modules/payments/payments.service';
import { demoCheckoutSchema } from '@/modules/payments/payments.schema';
import { rateLimit } from '@/core/rate-limit/rate-limit';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await rateLimit({ bucket: `pay:${actor.id}`, limit: 20, windowSeconds: 60 });
  const input = await parseJson(ctx.req, demoCheckoutSchema);
  return ok(await paymentsService.demoCheckout(actor, idParam(ctx), input), meta);
});
