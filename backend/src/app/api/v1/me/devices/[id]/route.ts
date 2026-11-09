import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { notificationCenter } from '@/modules/notifications/notification-center.service';

export const DELETE = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await notificationCenter.removeDevice(actor, idParam(ctx));
  return ok({ deleted: true }, meta);
});
