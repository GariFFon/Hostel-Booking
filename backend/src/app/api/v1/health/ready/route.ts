import { wrap } from '@/core/http/wrap';
import { ok } from '@/core/http/response';
import { AppError } from '@/core/errors/app-error';
import { prisma } from '@/infra/db/prisma';
import { redis } from '@/infra/redis/redis';

export const dynamic = 'force-dynamic';

async function probe(fn: () => Promise<unknown>): Promise<'up' | 'down'> {
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))]);
    return 'up';
  } catch {
    return 'down';
  }
}

// Readiness: 200 only when Postgres AND Redis answer. Used by deploy health checks.
export const GET = wrap(async ({ requestId }) => {
  const [database, cache] = await Promise.all([probe(() => prisma.$queryRaw`SELECT 1`), probe(() => redis.ping())]);
  if (database === 'down' || cache === 'down') {
    throw new AppError('DEPENDENCY_UNAVAILABLE', 'A dependency is unavailable', { database, redis: cache });
  }
  return ok({ status: 'ready', database, redis: cache }, { requestId });
});
