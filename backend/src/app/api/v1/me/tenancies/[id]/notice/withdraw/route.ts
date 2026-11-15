import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson, parseQuery } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { tenanciesService } from '@/modules/tenancies/tenancies.service';
import { giveNoticeSchema, moveOutSchema } from '@/modules/tenancies/tenancy.schema';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  return ok(await tenanciesService.withdrawNotice(actor, idParam(ctx), 'TENANT'), { requestId: ctx.requestId });
});
