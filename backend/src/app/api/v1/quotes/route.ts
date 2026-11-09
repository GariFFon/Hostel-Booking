import { authenticateOptional } from '@/core/auth/authenticate';
import { rateLimit } from '@/core/rate-limit/rate-limit';
import { wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { quoteRequestSchema } from '@/modules/pricing/quote.schema';
import { quoteService } from '@/modules/pricing/quote.service';

export const POST = wrap(async (ctx) => {
  await rateLimit({ bucket: `quote:ip:${ctx.ip}`, limit: 60, windowSeconds: 60 });
  const actor = await authenticateOptional(ctx.req); // optional: enables per-user coupon limits
  const input = await parseJson(ctx.req, quoteRequestSchema);
  return ok(await quoteService.quote(input, actor?.id), { requestId: ctx.requestId });
});
