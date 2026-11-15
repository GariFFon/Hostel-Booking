import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { ownerAudit } from '@/modules/audit/owner-audit.service';
import { ownerAuditQuerySchema } from '@/modules/audit/audit.schema';

/** The audit trail of my own properties. */
export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const { items, nextCursor } = await ownerAudit.list(actor, parseQuery(ctx.req, ownerAuditQuerySchema));
  return ok(items, { requestId: ctx.requestId, nextCursor });
});
