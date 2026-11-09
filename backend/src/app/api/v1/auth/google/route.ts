import { rateLimit } from '@/core/rate-limit/rate-limit';
import { clientMeta, wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { googleSchema } from '@/modules/auth/auth.schema';
import { authService } from '@/modules/auth/auth.service';

export const POST = wrap(async (ctx) => {
  await rateLimit({ bucket: `google:ip:${ctx.ip}`, limit: 30, windowSeconds: 900, failClosed: true });
  const { idToken, role } = await parseJson(ctx.req, googleSchema);
  return ok(await authService.google(idToken, role, clientMeta(ctx)), { requestId: ctx.requestId });
});
