import { wrap } from '@/core/http/wrap';
import { slugParam } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { termsService } from '@/modules/tenancies/terms.service';

export const GET = wrap(async (ctx) => ok(await termsService.publicTerms(slugParam(ctx)), { requestId: ctx.requestId }));
