import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { notificationCenter } from '@/modules/notifications/notification-center.service';
import { listNotificationsQuerySchema, registerDeviceSchema, updateNotificationPreferencesSchema } from '@/modules/notifications/notifications.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  return ok(await notificationCenter.getPreferences(actor), meta);
});

export const PATCH = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const patch = await parseJson(ctx.req, updateNotificationPreferencesSchema);
  return ok(await notificationCenter.updatePreferences(actor, patch), meta);
});
