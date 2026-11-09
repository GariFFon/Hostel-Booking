import { rateLimitAll } from '@/core/rate-limit/rate-limit';
import { clientMeta, wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { loginSchema } from '@/modules/auth/auth.schema';
import { authService } from '@/modules/auth/auth.service';

export const POST = wrap(async (ctx) => {
  const input = await parseJson(ctx.req, loginSchema);
  await rateLimitAll([
    { bucket: `login:ip:${ctx.ip}`, limit: 30, windowSeconds: 900, failClosed: true },
    { bucket: `login:email:${input.email}`, limit: 10, windowSeconds: 900, failClosed: true },
  ]);
  return ok(await authService.login(input.email, input.password, clientMeta(ctx)), { requestId: ctx.requestId });
});
