import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env';
import { Errors } from '../errors/app-error';
import type { Actor } from '../context/request-context';

const ISSUER = 'hostel-booking';
const AUDIENCE = 'hostel-booking-api';
const key = () => new TextEncoder().encode(env().JWT_ACCESS_SECRET);

export async function signAccessToken(actor: Actor): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = env().JWT_ACCESS_TTL_SECONDS;
  const token = await new SignJWT({ roles: actor.roles, ev: actor.emailVerified, tm: Date.now() }) // tm: ms issue time for precise revocation
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(actor.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(key());
  return { token, expiresIn };
}

export async function verifyAccessToken(token: string): Promise<{ actor: Actor; issuedAtMs: number }> {
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
    if (!payload.sub) throw new Error('missing sub');
    return {
      actor: { id: payload.sub, roles: (payload.roles as Actor['roles']) ?? [], emailVerified: payload.ev === true },
      issuedAtMs: typeof payload.tm === 'number' ? payload.tm : (payload.iat ?? 0) * 1000,
    };
  } catch {
    throw Errors.unauthenticated('Invalid or expired access token');
  }
}

/** Opaque random secret for refresh / verification / reset tokens. Only the sha256 is stored. */
export const newOpaqueToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
