import { Prisma } from '@/generated/prisma/client';
import type { z } from 'zod';
import { Errors } from '@/core/errors/app-error';
import { requireRole } from '@/core/auth/rbac';
import type { Actor } from '@/core/context/request-context';
import { prisma } from '@/infra/db/prisma';
import type { ownerAuditQuerySchema } from './audit.schema';

type Row = { id: bigint; actor_id: string | null; actor_role: string | null; action: string; entity_type: string; entity_id: string | null; outcome: 'SUCCESS' | 'FAILURE' | 'DENIED'; before: unknown; after: unknown; metadata: Record<string, unknown> | null; created_at: Date };

/**
 * The audit trail of an owner's own properties, and nothing else: rows whose `metadata.hostelId` is one of their properties (every
 * property-scoped change writes it), plus changes to the property record itself. It leaves out network addresses, device strings and
 * the hash chain, which only the platform's admins see.
 */
export const ownerAudit = {
  async list(actor: Actor, q: z.infer<typeof ownerAuditQuerySchema>) {
    requireRole(actor, 'OWNER');
    const hostels = await prisma.hostel.findMany({ where: { ownerId: actor.id, deletedAt: null }, select: { id: true, name: true } });
    const names = new Map(hostels.map((h) => [h.id, h.name]));
    if (q.hostelId && !names.has(q.hostelId)) throw Errors.notFound('Property'); // someone else's property looks exactly like a missing one
    const ids = q.hostelId ? [q.hostelId] : hostels.map((h) => h.id);
    if (ids.length === 0) return { items: [], nextCursor: null };

    const conds = [
      Prisma.sql`(metadata ->> 'hostelId' = ANY(${ids}::text[]) OR (entity_type = 'hostel' AND entity_id = ANY(${ids}::text[])))`,
      ...(q.action ? [Prisma.sql`action LIKE ${`${q.action.replace(/[\\%_]/g, '\\$&')}%`}`] : []),
      ...(q.entityType ? [Prisma.sql`entity_type = ${q.entityType}`] : []),
      ...(q.outcome ? [Prisma.sql`outcome = ${q.outcome}::"AuditOutcome"`] : []),
      ...(q.from ? [Prisma.sql`created_at >= ${new Date(q.from)}`] : []),
      ...(q.to ? [Prisma.sql`created_at <= ${new Date(q.to)}`] : []),
      ...(q.cursor ? [Prisma.sql`id < ${BigInt(q.cursor)}`] : []),
    ];
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT id, actor_id::text AS actor_id, actor_role, action, entity_type, entity_id, outcome, "before", "after", metadata, created_at
      FROM audit_logs WHERE ${Prisma.join(conds, ' AND ')} ORDER BY id DESC LIMIT ${q.limit + 1}`);
    const page = rows.slice(0, q.limit);
    const actorIds = [...new Set(page.map((r) => r.actor_id).filter((x): x is string => !!x))];
    const people = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true, profile: { select: { fullName: true } } } }) : [];
    const nameOf = new Map(people.map((p) => [p.id, p.profile?.fullName ?? p.email]));
    return {
      items: page.map((r) => {
        const hostelId = typeof r.metadata?.hostelId === 'string' ? r.metadata.hostelId : r.entity_type === 'hostel' ? r.entity_id : null;
        return {
          id: String(r.id), at: r.created_at.toISOString(), action: r.action, entityType: r.entity_type, entityId: r.entity_id, outcome: r.outcome,
          actor: r.actor_id ? { id: r.actor_id, name: nameOf.get(r.actor_id) ?? null, role: r.actor_role } : { id: null, name: null, role: r.actor_role ?? 'SYSTEM' },
          hostel: hostelId && names.has(hostelId) ? { id: hostelId, name: names.get(hostelId)! } : null,
          before: r.before ?? null, after: r.after ?? null, metadata: r.metadata ?? null,
        };
      }),
      nextCursor: rows.length > q.limit ? String(page[page.length - 1]!.id) : null,
    };
  },
};
