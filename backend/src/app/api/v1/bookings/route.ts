import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { bookingsService } from '@/modules/bookings/bookings.service';
import { cancelBookingSchema, createBookingSchema, listBookingsQuerySchema, ownerListBookingsQuerySchema, ownerCancelSchema, rejectBookingSchema, checkInSchema } from '@/modules/bookings/bookings.schema';
import { respondIdempotent } from '@/core/idempotency/respond';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const input = await parseJson(ctx.req, createBookingSchema);
  return respondIdempotent(ctx, actor, { required: true, body: input, status: 201 }, (key) => bookingsService.create(actor, input, key!));
});

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const q = parseQuery(ctx.req, listBookingsQuerySchema);
  const { items, nextCursor } = await bookingsService.list(actor, q, 'GUEST');
  return ok(items, { ...meta, nextCursor });
});
