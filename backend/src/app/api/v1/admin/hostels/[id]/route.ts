import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { hostelModerationService } from '@/modules/hostels/hostel-moderation.service';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  return ok(await hostelModerationService.get(actor, idParam(ctx)), meta);
});
