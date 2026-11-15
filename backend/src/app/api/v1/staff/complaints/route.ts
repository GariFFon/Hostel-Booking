import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { complaintsService } from '@/modules/complaints/complaints.service';
import { staffListComplaintsQuerySchema } from '@/modules/complaints/complaints.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const { items, nextCursor } = await complaintsService.staffList(actor, parseQuery(ctx.req, staffListComplaintsQuerySchema));
  return ok(items, { requestId: ctx.requestId, nextCursor });
});
