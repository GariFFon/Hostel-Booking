import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { ok } from '@/core/http/response';
import { notificationCenter } from '@/modules/notifications/notification-center.service';
import { rateLimit } from '@/core/rate-limit/rate-limit';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await rateLimit({ bucket: `unread:${actor.id}`, limit: 120, windowSeconds: 60 });
  return ok(await notificationCenter.unreadCount(actor), meta);
});
