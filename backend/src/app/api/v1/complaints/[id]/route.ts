import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { complaintsService } from '@/modules/complaints/complaints.service';

/** One complaint, shaped for whoever is asking: the tenant who filed it, the owner, the staff member it is assigned to, or an admin. */
export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await complaintsService.get(actor, idParam(ctx)), { requestId: ctx.requestId });
});
