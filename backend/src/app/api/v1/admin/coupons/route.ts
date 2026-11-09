import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { couponsService } from '@/modules/coupons/coupons.service';
import { createCouponSchema, listCouponsQuerySchema, updateCouponSchema } from '@/modules/coupons/coupons.schema';
import { rateLimit } from '@/core/rate-limit/rate-limit';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const q = parseQuery(ctx.req, listCouponsQuerySchema);
  const { items, nextCursor } = await couponsService.list(actor, 'ADMIN', q);
  return ok(items, { ...meta, nextCursor });
});

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await rateLimit({ bucket: `coupon-write:${actor.id}`, limit: 60, windowSeconds: 3600 });
  const input = await parseJson(ctx.req, createCouponSchema);
  return ok(await couponsService.create(actor, 'ADMIN', input), meta, 201);
});
