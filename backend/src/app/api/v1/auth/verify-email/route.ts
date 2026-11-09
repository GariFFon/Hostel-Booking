import { rateLimit } from '@/core/rate-limit/rate-limit';
import { wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { verifyEmailSchema } from '@/modules/auth/auth.schema';
import { authService } from '@/modules/auth/auth.service';

export const POST = wrap(async (ctx) => {
  await rateLimit({ bucket: `verify:ip:${ctx.ip}`, limit: 30, windowSeconds: 900 });
  const { token } = await parseJson(ctx.req, verifyEmailSchema);
  await authService.verifyEmail(token);
  return ok({ verified: true }, { requestId: ctx.requestId });
});
