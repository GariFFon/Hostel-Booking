import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { kycService } from '@/modules/kyc/kyc.service';
import { addKycDocumentSchema, kycListQuerySchema, kycRejectSchema, updateOwnerProfileSchema } from '@/modules/kyc/kyc.schema';
import { paginationSchema } from '@/core/http/pagination';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const q = parseQuery(ctx.req, paginationSchema.extend(kycListQuerySchema.shape));
  const { items, nextCursor } = await kycService.adminList(actor, q);
  return ok(items, { ...meta, nextCursor });
});
