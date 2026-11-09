import { NextResponse } from 'next/server';
import { rateLimit } from '@/core/rate-limit/rate-limit';
import { clientMeta, wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { registerSchema } from '@/modules/auth/auth.schema';
import { authService } from '@/modules/auth/auth.service';

export const POST = wrap(async (ctx): Promise<NextResponse> => {
  await rateLimit({ bucket: `register:ip:${ctx.ip}`, limit: 10, windowSeconds: 3600, failClosed: true });
  const input = await parseJson(ctx.req, registerSchema);
  return ok(await authService.register(input, clientMeta(ctx)), { requestId: ctx.requestId }, 201);
});
