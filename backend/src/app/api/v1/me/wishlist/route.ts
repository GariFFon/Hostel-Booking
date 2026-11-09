import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { wishlistService } from '@/modules/wishlist/wishlist.service';
import { wishlistQuerySchema } from '@/modules/wishlist/wishlist.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const q = parseQuery(ctx.req, wishlistQuerySchema);
  const { items, nextCursor } = await wishlistService.list(actor, q);
  return ok(items, { ...meta, nextCursor });
});
