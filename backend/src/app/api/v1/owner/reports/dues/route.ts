import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { reportsService } from '@/modules/reports/reports.service';
import { reportQuerySchema } from '@/modules/reports/reports.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await reportsService.dues(actor, parseQuery(ctx.req, reportQuerySchema)), { requestId: ctx.requestId });
});
