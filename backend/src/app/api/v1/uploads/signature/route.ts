import { authenticate } from '@/core/auth/authenticate';
import { wrap } from '@/core/http/wrap';
import { parseJson } from '@/core/http/parse';
import { ok } from '@/core/http/response';
import { uploadsService } from '@/modules/uploads/uploads.service';
import { signatureRequestSchema } from '@/modules/uploads/uploads.schema';
import { rateLimit } from '@/core/rate-limit/rate-limit';

export const POST = wrap(async (ctx) => {
  const actor = await authenticate(ctx.req);
  const meta = { requestId: ctx.requestId };
  await rateLimit({ bucket: `upload-sig:${actor.id}`, limit: 40, windowSeconds: 600 });
  const input = await parseJson(ctx.req, signatureRequestSchema);
  return ok(await uploadsService.createSignature(actor, input), meta);
});
