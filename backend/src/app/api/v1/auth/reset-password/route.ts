import { rateLimit } from '@/core/rate-limit/rate-limit';
import { wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { resetPasswordSchema } from '@/modules/auth/auth.schema';
import { authService } from '@/modules/auth/auth.service';

export const POST = wrap(async (ctx) => {
  await rateLimit({ bucket: `reset:ip:${ctx.ip}`, limit: 20, windowSeconds: 900, failClosed: true });
  const { token, password } = await parseJson(ctx.req, resetPasswordSchema);
  await authService.resetPassword(token, password);
  return ok({ reset: true }, { requestId: ctx.requestId });
});
