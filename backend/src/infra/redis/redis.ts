import Redis from 'ioredis';
import { logger } from '@/core/logger/logger';

const g = globalThis as unknown as { redis?: Redis };

function create(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  const client = new Redis(url, {
    // Commands issued during (re)connect are queued, then fail after 2 retries, so callers can
    // degrade to "cache miss" instead of hanging.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  client.on('error', (err) => logger.warn({ err: err.message }, 'redis error'));
  return client;
}

export const redis: Redis = (g.redis ??= create());

/** All keys are namespaced per environment so dev/test/prod can share one Redis safely. */
export const key = (...parts: (string | number)[]) =>
  `hb:${process.env.APP_ENV ?? 'local'}:${parts.join(':')}`;
