import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { hostelsService } from '@/modules/hostels/hostels.service';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  return ok(await hostelsService.submit(actor, idParam(ctx)), meta);
});
