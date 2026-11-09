import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { idParam, parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { priceRulesService } from '@/modules/pricing/price-rules.service';
import { createPriceRuleSchema, updatePriceRuleSchema } from '@/modules/pricing/price-rules.schema';

export const PATCH = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  const input = await parseJson(ctx.req, updatePriceRuleSchema);
  return ok(await priceRulesService.update(actor, idParam(ctx), input), meta);
});

export const DELETE = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await priceRulesService.remove(actor, idParam(ctx));
  return ok({ deleted: true }, meta);
});
