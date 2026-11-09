import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { ok } from '@/core/http/response';
import { wishlistService } from '@/modules/wishlist/wishlist.service';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  return ok(await wishlistService.ids(actor), meta);
});
