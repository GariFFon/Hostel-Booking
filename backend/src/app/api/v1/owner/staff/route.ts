import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { staffService } from '@/modules/staff/staff.service';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await staffService.ownerTeam(actor), { requestId: ctx.requestId });
});
