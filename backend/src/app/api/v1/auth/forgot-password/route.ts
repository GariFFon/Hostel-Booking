import { rateLimitAll } from '@/core/rate-limit/rate-limit';
import { wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { forgotPasswordSchema } from '@/modules/auth/auth.schema';
import { authService } from '@/modules/auth/auth.service';

export const POST = wrap(async (ctx) => {
  const { email } = await parseJson(ctx.req, forgotPasswordSchema);
  await rateLimitAll([
    { bucket: `forgot:ip:${ctx.ip}`, limit: 20, windowSeconds: 3600, failClosed: true },
    { bucket: `forgot:email:${email}`, limit: 5, windowSeconds: 3600, failClosed: true },
  ]);
  await authService.forgotPassword(email);
  return ok({ sent: true }, { requestId: ctx.requestId });
});
