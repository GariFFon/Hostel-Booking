import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { bookingsService } from '@/modules/bookings/bookings.service';
import { cancelBookingSchema, createBookingSchema, listBookingsQuerySchema, ownerListBookingsQuerySchema, ownerCancelSchema, rejectBookingSchema, checkInSchema } from '@/modules/bookings/bookings.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const q = parseQuery(ctx.req, ownerListBookingsQuerySchema);
  const { items, nextCursor } = await bookingsService.list(actor, q, 'OWNER');
  return ok(items, { ...meta, nextCursor });
});
