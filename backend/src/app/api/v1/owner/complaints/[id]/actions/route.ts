import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { complaintsService } from '@/modules/complaints/complaints.service';
import { ownerActionSchema } from '@/modules/complaints/complaints.schema';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const input = await parseJson(ctx.req, ownerActionSchema);
  return ok(await complaintsService.ownerAction(actor, idParam(ctx), input), { requestId: ctx.requestId });
});
