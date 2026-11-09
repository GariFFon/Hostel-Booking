import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { authService } from '@/modules/auth/auth.service';
import { updateProfileSchema } from '@/modules/users/users.schema';
import { usersService } from '@/modules/users/users.service';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await authService.me(actor.id), { requestId: ctx.requestId });
});

export const PATCH = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const input = await parseJson(ctx.req, updateProfileSchema);
  return ok(await usersService.updateProfile(actor.id, input), { requestId: ctx.requestId });
});
