import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { ok } from '@/core/http/response';
import { authService } from '@/modules/auth/auth.service';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  await authService.logoutAll(actor.id);
  return ok({ loggedOut: true }, { requestId: ctx.requestId });
});
