import { authenticate } from '@/core/auth/authenticate';
import { rateLimit } from '@/core/rate-limit/rate-limit';
import { clientMeta, wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { changePasswordSchema } from '@/modules/auth/auth.schema';
import { authService } from '@/modules/auth/auth.service';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  await rateLimit({ bucket: `chgpw:user:${actor.id}`, limit: 10, windowSeconds: 900, failClosed: true });
  const { currentPassword, newPassword } = await parseJson(ctx.req, changePasswordSchema);
  return ok(await authService.changePassword(actor.id, currentPassword, newPassword, clientMeta(ctx)), { requestId: ctx.requestId });
});
