import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { rateLimit } from '@/core/rate-limit/rate-limit';
import { depositOnline } from '@/modules/tenancies/deposit-online';

/** Starts (or resumes) the online payment of the security deposit. */
export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  await rateLimit({ bucket: `pay:${actor.id}`, limit: 20, windowSeconds: 60 });
  return ok(await depositOnline.initiate(actor, idParam(ctx)), { requestId: ctx.requestId }, 201);
});
