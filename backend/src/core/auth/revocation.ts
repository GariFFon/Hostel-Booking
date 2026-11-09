import { redis, key } from '@/infra/redis/redis';
import { env } from '../config/env';
import { logger } from '../logger/logger';

const notBeforeKey = (userId: string) => key('tokens-not-before', userId);

/**
 * Invalidates every access token issued before "now" for a user (password reset/change, suspension).
 * Stored for slightly longer than the access-token TTL, after which old tokens are expired anyway.
 * Compared in milliseconds against the token's `tm` claim, so a token minted right after this call is accepted.
 */
export async function revokeAccessTokens(userId: string) {
  try {
    await redis.set(notBeforeKey(userId), String(Date.now()), 'EX', env().JWT_ACCESS_TTL_SECONDS + 60);
  } catch (e) {
    logger.warn({ err: (e as Error).message, userId }, 'could not record token revocation (redis down)');
  }
}

/** True when the token was issued before a revocation. Fails open if Redis is unavailable. */
export async function isRevoked(userId: string, issuedAtMs: number): Promise<boolean> {
  try {
    const v = await redis.get(notBeforeKey(userId));
    return v !== null && issuedAtMs < Number(v);
  } catch {
    return false;
  }
}
