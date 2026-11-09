import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { roomsService } from '@/modules/rooms/rooms.service';
import { blockSchema, calendarQuerySchema, createRoomTypeSchema, updateRoomTypeSchema } from '@/modules/rooms/rooms.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  return ok(await roomsService.list(actor, idParam(ctx)), meta);
});

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const input = await parseJson(ctx.req, createRoomTypeSchema);
  return ok(await roomsService.create(actor, idParam(ctx), input), meta, 201);
});
