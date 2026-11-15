import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { complaintsService } from '@/modules/complaints/complaints.service';
import { ownerListComplaintsQuerySchema } from '@/modules/complaints/complaints.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const { items, nextCursor } = await complaintsService.adminList(actor, parseQuery(ctx.req, ownerListComplaintsQuerySchema));
  return ok(items, { requestId: ctx.requestId, nextCursor });
});
