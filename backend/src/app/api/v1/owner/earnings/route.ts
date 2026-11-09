import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { earningsService } from '@/modules/earnings/earnings.service';
import { earningsQuerySchema } from '@/modules/earnings/earnings.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const q = parseQuery(ctx.req, earningsQuerySchema);
  return ok(await earningsService.summary(actor, q), meta);
});
