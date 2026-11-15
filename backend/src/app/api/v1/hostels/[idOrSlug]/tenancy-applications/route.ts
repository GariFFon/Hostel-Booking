import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery, slugParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { applicationsService } from '@/modules/tenancies/applications.service';
import { createApplicationSchema } from '@/modules/tenancies/tenancy.schema';
import { resolveHostelId } from '@/modules/tenancies/resolve';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const input = await parseJson(ctx.req, createApplicationSchema);
  return ok(await applicationsService.create(actor, await resolveHostelId(slugParam(ctx)), input), meta, 201);
});
