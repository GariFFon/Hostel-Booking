import { AsyncLocalStorage } from 'node:async_hooks';

export interface Actor {
  id: string;
  roles: ('GUEST' | 'OWNER' | 'ADMIN')[];
  emailVerified: boolean;
}

export interface RequestContext {
  requestId: string;
  ip: string;
  userAgent: string | null;
  actor: Actor | null;
}

const als = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(ctx: RequestContext, fn: () => T): T => als.run(ctx, fn);
export const getContext = (): RequestContext | undefined => als.getStore();

/** Authentication fills the actor so audit logging can attribute every change without plumbing. */
export function setActor(actor: Actor | null) {
  const ctx = als.getStore();
  if (ctx) ctx.actor = actor;
}
