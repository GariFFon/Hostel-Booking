import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { ok } from '@/core/http/response';
import { usersService } from '@/modules/users/users.service';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await usersService.becomeOwner(actor.id), { requestId: ctx.requestId });
});
