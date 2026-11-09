import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { hostelModerationService } from '@/modules/hostels/hostel-moderation.service';
import { createHostelSchema, listOwnerHostelsQuerySchema, reasonSchema, updateHostelSchema } from '@/modules/hostels/hostels.schema';
import { paginationSchema } from '@/core/http/pagination';
import { z } from 'zod';
import { hostelStatusSchema } from '@/modules/hostels/hostels.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const q = parseQuery(ctx.req, paginationSchema.extend({ status: hostelStatusSchema.optional() }));
  const { items, nextCursor } = await hostelModerationService.list(actor, q);
  return ok(items, { ...meta, nextCursor });
});
