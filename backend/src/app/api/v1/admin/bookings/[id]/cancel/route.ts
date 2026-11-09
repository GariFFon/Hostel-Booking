import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { bookingsService } from '@/modules/bookings/bookings.service';
import { cancelBookingSchema, createBookingSchema, listBookingsQuerySchema, ownerListBookingsQuerySchema, ownerCancelSchema, rejectBookingSchema, checkInSchema } from '@/modules/bookings/bookings.schema';
import { respondIdempotent } from '@/core/idempotency/respond';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const { reason } = await parseJson(ctx.req, ownerCancelSchema);
  return respondIdempotent(ctx, actor, { required: false, body: { id: idParam(ctx), reason } }, () => bookingsService.cancel(actor, 'ADMIN', idParam(ctx), reason));
});
