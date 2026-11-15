import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery, slugParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { tenanciesService } from '@/modules/tenancies/tenancies.service';
import { createTenancySchema, ownerListTenanciesQuerySchema } from '@/modules/tenancies/tenancy.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const { items, nextCursor } = await tenanciesService.ownerList(actor, parseQuery(ctx.req, ownerListTenanciesQuerySchema));
  return ok(items, { requestId: ctx.requestId, nextCursor });
});

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const input = await parseJson(ctx.req, createTenancySchema);
  return ok(await tenanciesService.create(actor, input), { requestId: ctx.requestId }, 201);
});
