import type { NextRequest } from 'next/server';
import { setActor, type Actor } from '../context/request-context';
import { Errors } from '../errors/app-error';
import { rateLimit } from '../rate-limit/rate-limit';
import { isRevoked } from './revocation';
import { requireRole, type RoleName } from './rbac';
import { verifyAccessToken } from './tokens';

export async function authenticate(req: NextRequest): Promise<Actor> {
  const header = req.headers.get('authorization');
  const [scheme, token] = header?.split(' ') ?? [];
  if (scheme?.toLowerCase() !== 'bearer' || !token) throw Errors.unauthenticated();
  const { actor, issuedAtMs } = await verifyAccessToken(token);
  if (await isRevoked(actor.id, issuedAtMs)) throw Errors.unauthenticated('Session is no longer valid');
  setActor(actor);
  await userCeiling(actor.id, req.method);
  return actor;
}

/**
 * A default ceiling for every authenticated caller, on top of the tighter limits some routes add. Many routes have no limit of
 * their own, so without this one compromised or buggy client could hammer writes (booking holds, uploads, reviews) unchecked.
 * Per *user*, not per IP, so it stays meaningful behind a shared NAT or proxy. Fails open if Redis is down.
 */
export const USER_LIMITS = { read: { limit: 600, windowSeconds: 60 }, write: { limit: 120, windowSeconds: 60 } } as const;

async function userCeiling(userId: string, method: string): Promise<void> {
  const safe = method === 'GET' || method === 'HEAD';
  const rule = safe ? USER_LIMITS.read : USER_LIMITS.write;
  await rateLimit({ bucket: `user:${userId}:${safe ? 'read' : 'write'}`, ...rule });
}

/** Optional auth for public endpoints that personalise when a token is present. */
export async function authenticateOptional(req: NextRequest): Promise<Actor | null> {
  return req.headers.get('authorization') ? authenticate(req) : null;
}

export async function authenticateWithRole(req: NextRequest, ...roles: RoleName[]): Promise<Actor> {
  return requireRole(await authenticate(req), ...roles);
}
