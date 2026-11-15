import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { rentOnline } from '@/modules/rent/rent-online.service';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await rentOnline.get(actor, idParam(ctx)), { requestId: ctx.requestId });
});
