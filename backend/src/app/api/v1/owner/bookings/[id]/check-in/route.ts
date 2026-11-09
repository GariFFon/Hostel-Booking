import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { bookingLifecycle } from '@/modules/bookings/booking-lifecycle.service';
import { cancelBookingSchema, createBookingSchema, listBookingsQuerySchema, ownerListBookingsQuerySchema, ownerCancelSchema, rejectBookingSchema, checkInSchema } from '@/modules/bookings/bookings.schema';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const { notes } = await parseJson(ctx.req, checkInSchema);
  return ok(await bookingLifecycle.checkIn(actor, 'OWNER', idParam(ctx), notes), meta);
});
