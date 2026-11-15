import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { staffService } from '@/modules/staff/staff.service';
import { setHostelsSchema } from '@/modules/staff/staff.schema';

export const PUT = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const input = await parseJson(ctx.req, setHostelsSchema);
  return ok(await staffService.setHostels(actor, idParam(ctx), input.hostelIds), { requestId: ctx.requestId });
});
