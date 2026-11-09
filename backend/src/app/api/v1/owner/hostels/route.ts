import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { hostelsService } from '@/modules/hostels/hostels.service';
import { createHostelSchema, listOwnerHostelsQuerySchema, reasonSchema, updateHostelSchema } from '@/modules/hostels/hostels.schema';
import { paginationSchema } from '@/core/http/pagination';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const q = parseQuery(ctx.req, paginationSchema.extend(listOwnerHostelsQuerySchema.shape));
  const { items, nextCursor } = await hostelsService.list(actor, q);
  return ok(items, { ...meta, nextCursor });
});

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const input = await parseJson(ctx.req, createHostelSchema);
  return ok(await hostelsService.create(actor, input), meta, 201);
});
