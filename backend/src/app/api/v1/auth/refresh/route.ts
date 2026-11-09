import { rateLimit } from '@/core/rate-limit/rate-limit';
import { clientMeta, wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { refreshSchema } from '@/modules/auth/auth.schema';
import { authService } from '@/modules/auth/auth.service';

export const POST = wrap(async (ctx) => {
  await rateLimit({ bucket: `refresh:ip:${ctx.ip}`, limit: 120, windowSeconds: 60, failClosed: true });
  const { refreshToken } = await parseJson(ctx.req, refreshSchema);
  return ok(await authService.refresh(refreshToken, clientMeta(ctx)), { requestId: ctx.requestId });
});
