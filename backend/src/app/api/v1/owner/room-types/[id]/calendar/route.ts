import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { roomsService } from '@/modules/rooms/rooms.service';
import { blockSchema, calendarQuerySchema, createRoomTypeSchema, updateRoomTypeSchema } from '@/modules/rooms/rooms.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const { from, to } = parseQuery(ctx.req, calendarQuerySchema);
  return ok(await roomsService.calendar(actor, idParam(ctx), from, to), meta);
});
