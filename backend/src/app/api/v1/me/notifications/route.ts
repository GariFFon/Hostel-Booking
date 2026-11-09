import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { notificationCenter } from '@/modules/notifications/notification-center.service';
import { listNotificationsQuerySchema, registerDeviceSchema, updateNotificationPreferencesSchema } from '@/modules/notifications/notifications.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const q = parseQuery(ctx.req, listNotificationsQuerySchema);
  const { items, nextCursor } = await notificationCenter.list(actor, q);
  return ok(items, { ...meta, nextCursor });
});
