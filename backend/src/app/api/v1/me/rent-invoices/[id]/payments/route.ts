import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { rateLimit } from '@/core/rate-limit/rate-limit';
import { rentOnline } from '@/modules/rent/rent-online.service';

/** Starts (or resumes) an online payment of the invoice's balance. */
export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  await rateLimit({ bucket: `pay:${actor.id}`, limit: 20, windowSeconds: 60 });
  return ok(await rentOnline.initiate(actor, idParam(ctx)), { requestId: ctx.requestId }, 201);
});
