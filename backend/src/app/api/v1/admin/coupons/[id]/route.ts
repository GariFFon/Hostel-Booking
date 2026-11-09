import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { couponsService } from '@/modules/coupons/coupons.service';
import { createCouponSchema, listCouponsQuerySchema, updateCouponSchema } from '@/modules/coupons/coupons.schema';
import { rateLimit } from '@/core/rate-limit/rate-limit';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  return ok(await couponsService.get(actor, 'ADMIN', idParam(ctx)), meta);
});

export const PATCH = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await rateLimit({ bucket: `coupon-write:${actor.id}`, limit: 60, windowSeconds: 3600 });
  const patch = await parseJson(ctx.req, updateCouponSchema);
  return ok(await couponsService.update(actor, 'ADMIN', idParam(ctx), patch), meta);
});

export const DELETE = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await rateLimit({ bucket: `coupon-write:${actor.id}`, limit: 60, windowSeconds: 3600 });
  await couponsService.remove(actor, 'ADMIN', idParam(ctx));
  return ok({ deleted: true }, meta);
});
