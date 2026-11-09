import { wrap } from '@/core/http/wrap';
import { ok } from '@/core/http/response';

export const dynamic = 'force-dynamic';

// Liveness only. Readiness (DB + Redis) is added once those clients exist.
export const GET = wrap(async ({ requestId }) =>
  ok({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) }, { requestId }),
);
