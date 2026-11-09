import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { roomsService } from '@/modules/rooms/rooms.service';
import { blockSchema, calendarQuerySchema, createRoomTypeSchema, updateRoomTypeSchema } from '@/modules/rooms/rooms.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  return ok(await roomsService.get(actor, idParam(ctx)), meta);
});

export const PATCH = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const input = await parseJson(ctx.req, updateRoomTypeSchema);
  return ok(await roomsService.update(actor, idParam(ctx), input), meta);
});

export const DELETE = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await roomsService.remove(actor, idParam(ctx));
  return ok({ deleted: true }, meta);
});
