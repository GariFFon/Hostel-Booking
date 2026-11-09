import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/infra/db/prisma';
import { getContext } from '@/core/context/request-context';

const SENSITIVE = /password|token|secret|hash|authorization|idToken/i;

/** Deep-redact secrets so before/after snapshots are safe to persist. */
export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redact) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE.test(k) ? '[REDACTED]' : redact(v)]),
    ) as T;
  }
  return value;
}

export interface AuditEntry {
  action: string; // namespace.verb, e.g. auth.login, hostel.update
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  outcome?: 'SUCCESS' | 'FAILURE' | 'DENIED';
  metadata?: Record<string, unknown>;
  /** Override when the actor is not the authenticated caller (e.g. login before a token exists). */
  actorId?: string | null;
  actorRole?: string | null;
}

type Client = Pick<Prisma.TransactionClient, 'auditLog'>;

/**
 * Writes an audit row. Pass the active transaction client so the row commits atomically with the change
 * it describes. The hash chain is computed by a database trigger.
 */
export async function recordAudit(entry: AuditEntry, db: Client = prisma) {
  const ctx = getContext();
  const actor = ctx?.actor;
  await db.auditLog.create({
    data: {
      actorId: entry.actorId !== undefined ? entry.actorId : (actor?.id ?? null),
      actorRole: entry.actorRole !== undefined ? entry.actorRole : (actor ? actor.roles.join(',') : null),
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before === undefined ? undefined : (redact(entry.before) as Prisma.InputJsonValue),
      after: entry.after === undefined ? undefined : (redact(entry.after) as Prisma.InputJsonValue),
      outcome: entry.outcome ?? 'SUCCESS',
      requestId: ctx?.requestId ?? null,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      metadata: entry.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
