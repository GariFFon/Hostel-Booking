import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { usersService } from '@/modules/users/users.service';
import { z } from 'zod';

export const PUT = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const { publicId } = await parseJson(ctx.req, z.object({ publicId: z.string().min(10).max(300) }));
  return ok(await usersService.setAvatar(actor.id, publicId), meta);
});
