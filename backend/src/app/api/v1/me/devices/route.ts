import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { notificationCenter } from '@/modules/notifications/notification-center.service';
import { listNotificationsQuerySchema, registerDeviceSchema, updateNotificationPreferencesSchema } from '@/modules/notifications/notifications.schema';
import { rateLimit } from '@/core/rate-limit/rate-limit';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await rateLimit({ bucket: `device:${actor.id}`, limit: 30, windowSeconds: 3600 });
  const input = await parseJson(ctx.req, registerDeviceSchema);
  return ok(await notificationCenter.registerDevice(actor, input), meta, 201);
});
