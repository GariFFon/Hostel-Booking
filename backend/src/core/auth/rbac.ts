import type { Actor } from '../context/request-context';
import { Errors } from '../errors/app-error';

export type RoleName = Actor['roles'][number];

export const hasRole = (actor: Actor, ...roles: RoleName[]) => roles.some((r) => actor.roles.includes(r));

export function requireRole(actor: Actor, ...roles: RoleName[]): Actor {
  if (!hasRole(actor, ...roles)) throw Errors.forbidden();
  return actor;
}

export function requireVerifiedEmail(actor: Actor): Actor {
  if (!actor.emailVerified) throw Errors.forbidden('Verify your email address to continue');
  return actor;
}
