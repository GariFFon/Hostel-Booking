import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { paymentsService } from '@/modules/payments/payments.service';
import { respondIdempotent } from '@/core/idempotency/respond';
import { rateLimit } from '@/core/rate-limit/rate-limit';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  await rateLimit({ bucket: `pay:${actor.id}`, limit: 20, windowSeconds: 60 });
  return respondIdempotent(ctx, actor, { required: false, body: { id: idParam(ctx) }, status: 201 }, () => paymentsService.initiate(actor, idParam(ctx)));
});
