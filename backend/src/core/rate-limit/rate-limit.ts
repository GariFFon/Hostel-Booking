import { randomUUID } from 'node:crypto';
import { redis, key } from '@/infra/redis/redis';
import { AppError, Errors } from '../errors/app-error';
import { logger } from '../logger/logger';

// Sliding-window log in a sorted set, atomic via Lua. Returns {allowed, remaining, retryAfterMs}.
const SCRIPT = `
local now = tonumber(ARGV[1]); local window = tonumber(ARGV[2]); local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])
if count < limit then
  redis.call('ZADD', KEYS[1], now, ARGV[4]); redis.call('PEXPIRE', KEYS[1], window)
  return {1, limit - count - 1, 0}
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
return {0, 0, tonumber(oldest[2]) + window - now}
`;

export interface RateLimitRule {
  /** e.g. "login:ip:1.2.3.4" */
  bucket: string;
  limit: number;
  windowSeconds: number;
  /** Auth-sensitive routes fail closed when Redis is down; others fail open. */
  failClosed?: boolean;
}

export async function rateLimit(rule: RateLimitRule): Promise<void> {
  try {
    const [allowed, , retryMs] = (await redis.eval(
      SCRIPT, 1, key('rl', rule.bucket), Date.now(), rule.windowSeconds * 1000, rule.limit, randomUUID(),
    )) as [number, number, number];
    if (!allowed) throw Errors.rateLimited(Math.max(1, Math.ceil(retryMs / 1000)));
  } catch (e) {
    if (e instanceof AppError) throw e;
    logger.warn({ err: (e as Error).message, bucket: rule.bucket }, 'rate limiter unavailable');
    if (rule.failClosed) throw new AppError('DEPENDENCY_UNAVAILABLE', 'Service temporarily unavailable');
  }
}

export const rateLimitAll = (rules: RateLimitRule[]) => Promise.all(rules.map(rateLimit)).then(() => undefined);
