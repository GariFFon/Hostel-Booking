import { rateLimitAll } from '@/core/rate-limit/rate-limit';
import { wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { resendVerificationSchema } from '@/modules/auth/auth.schema';
import { authService } from '@/modules/auth/auth.service';

export const POST = wrap(async (ctx) => {
  const { email } = await parseJson(ctx.req, resendVerificationSchema);
  await rateLimitAll([
    { bucket: `resend:ip:${ctx.ip}`, limit: 10, windowSeconds: 3600, failClosed: true },
    { bucket: `resend:email:${email}`, limit: 3, windowSeconds: 3600, failClosed: true },
  ]);
  await authService.resendVerification(email);
  return ok({ sent: true }, { requestId: ctx.requestId }); // identical whether or not the account exists
});
