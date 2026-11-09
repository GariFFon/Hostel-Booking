import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { wishlistService } from '@/modules/wishlist/wishlist.service';
import { rateLimit } from '@/core/rate-limit/rate-limit';

export const PUT = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await rateLimit({ bucket: `wishlist:${actor.id}`, limit: 120, windowSeconds: 60 });
  return ok(await wishlistService.add(actor, idParam(ctx, 'hostelId')), meta);
});

export const DELETE = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await rateLimit({ bucket: `wishlist:${actor.id}`, limit: 120, windowSeconds: 60 });
  return ok(await wishlistService.remove(actor, idParam(ctx, 'hostelId')), meta);
});
