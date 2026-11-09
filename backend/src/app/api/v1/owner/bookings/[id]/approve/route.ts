import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { bookingLifecycle } from '@/modules/bookings/booking-lifecycle.service';
import { respondIdempotent } from '@/core/idempotency/respond';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return respondIdempotent(ctx, actor, { required: false, body: { id: idParam(ctx) } }, () => bookingLifecycle.approve(actor, 'OWNER', idParam(ctx)));
});
