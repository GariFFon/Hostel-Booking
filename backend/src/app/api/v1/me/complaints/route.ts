import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { complaintsService } from '@/modules/complaints/complaints.service';
import { createComplaintSchema, listComplaintsQuerySchema } from '@/modules/complaints/complaints.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const { items, nextCursor } = await complaintsService.listMine(actor, parseQuery(ctx.req, listComplaintsQuerySchema));
  return ok(items, { requestId: ctx.requestId, nextCursor });
});

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const input = await parseJson(ctx.req, createComplaintSchema);
  return ok(await complaintsService.create(actor, input), { requestId: ctx.requestId }, 201);
});
