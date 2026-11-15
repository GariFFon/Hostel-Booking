import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { rentReceiptsService } from '@/modules/rent/rent-receipts.service';

/** A short-lived link to the invoice as a PDF. */
export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await rentReceiptsService.invoiceLink(actor, idParam(ctx), 'OWNER'), { requestId: ctx.requestId });
});
