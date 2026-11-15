import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { rateLimit } from '@/core/rate-limit/rate-limit';
import { rentOnline } from '@/modules/rent/rent-online.service';
import { demoCheckoutRentSchema } from '@/modules/rent/rent.schema';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  await rateLimit({ bucket: `pay:${actor.id}`, limit: 20, windowSeconds: 60 });
  const input = await parseJson(ctx.req, demoCheckoutRentSchema);
  return ok(await rentOnline.demoCheckout(actor, idParam(ctx), input), { requestId: ctx.requestId });
});
