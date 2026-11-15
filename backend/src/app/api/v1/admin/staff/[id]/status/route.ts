import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { staffService } from '@/modules/staff/staff.service';
import { setStatusSchema } from '@/modules/staff/staff.schema';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const input = await parseJson(ctx.req, setStatusSchema);
  await staffService.setStatus(actor, idParam(ctx), input.status);
  return ok(await staffService.adminList(actor), { requestId: ctx.requestId });
});
