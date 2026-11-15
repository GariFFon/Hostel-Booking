import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { rentReceiptsService } from '@/modules/rent/rent-receipts.service';

/** A short-lived link to the receipt PDF. */
export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await rentReceiptsService.link(actor, idParam(ctx), 'TENANT'), { requestId: ctx.requestId });
});
