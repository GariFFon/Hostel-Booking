import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { staffService } from '@/modules/staff/staff.service';
import { ownerInviteSchema } from '@/modules/staff/staff.schema';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const input = await parseJson(ctx.req, ownerInviteSchema);
  return ok(await staffService.ownerInvite(actor, input), { requestId: ctx.requestId }, 201);
});
