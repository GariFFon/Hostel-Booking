import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { auditViewer } from '@/modules/audit/audit-viewer.service';
import { auditQuerySchema } from '@/modules/audit/audit.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const q = parseQuery(ctx.req, auditQuerySchema);
  const { items, nextCursor } = await auditViewer.list(actor, q);
  return ok(items, { ...meta, nextCursor });
});
