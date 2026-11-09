import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { hostelModerationService } from '@/modules/hostels/hostel-moderation.service';
import { createHostelSchema, listOwnerHostelsQuerySchema, reasonSchema, updateHostelSchema } from '@/modules/hostels/hostels.schema';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const { reason } = await parseJson(ctx.req, reasonSchema);
  return ok(await hostelModerationService.suspend(actor, idParam(ctx), reason), meta);
});
