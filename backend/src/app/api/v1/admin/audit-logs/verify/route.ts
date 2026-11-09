import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { ok } from '@/core/http/response';
import { auditViewer } from '@/modules/audit/audit-viewer.service';
import { auditQuerySchema } from '@/modules/audit/audit.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  return ok(await auditViewer.verify(actor), meta);
});
