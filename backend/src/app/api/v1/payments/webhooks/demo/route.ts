import { wrap } from '@/core/http/wrap';
import { ok } from '@/core/http/response';
import { processDemoWebhook } from '@/modules/payments/webhooks.service';

// Public endpoint called by the (demo) gateway. Authenticity comes from the HMAC signature over the exact raw body,
// so the body must be read as text, never re-serialised.
export const POST = wrap(async (ctx) => {
  const raw = await ctx.req.text();
  const outcome = await processDemoWebhook(raw, ctx.req.headers.get('x-demo-signature'));
  return ok({ received: true, outcome }, { requestId: ctx.requestId });
});
