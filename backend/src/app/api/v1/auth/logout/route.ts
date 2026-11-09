import { wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { logoutSchema } from '@/modules/auth/auth.schema';
import { authService } from '@/modules/auth/auth.service';

export const POST = wrap(async (ctx) => {
  const { refreshToken } = await parseJson(ctx.req, logoutSchema);
  await authService.logout(refreshToken);
  return ok({ loggedOut: true }, { requestId: ctx.requestId });
});
