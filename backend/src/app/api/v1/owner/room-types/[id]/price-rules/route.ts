import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { priceRulesService } from '@/modules/pricing/price-rules.service';
import { createPriceRuleSchema, updatePriceRuleSchema } from '@/modules/pricing/price-rules.schema';

export const GET = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  return ok(await priceRulesService.list(actor, idParam(ctx)), meta);
});

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const input = await parseJson(ctx.req, createPriceRuleSchema);
  return ok(await priceRulesService.create(actor, idParam(ctx), input), meta, 201);
});
