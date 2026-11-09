import type { z } from 'zod';
import { type auditQuerySchema } from './audit.schema';
import { Prisma } from '@/generated/prisma/client';
import { requireRole } from '@/core/auth/rbac';
import type { Actor } from '@/core/context/request-context';
import { prisma } from '@/infra/db/prisma';

export const auditViewer = {
  async list(actor: Actor, q: z.infer<typeof auditQuerySchema>) {
    requireRole(actor, 'ADMIN');
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}), ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}), ...(q.outcome ? { outcome: q.outcome } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.cursor ? { id: { lt: BigInt(q.cursor) } } : {}),
    };
    const rows = await prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((r) => ({
        id: String(r.id), at: r.createdAt.toISOString(), actorId: r.actorId, actorRole: r.actorRole, action: r.action, entityType: r.entityType, entityId: r.entityId, outcome: r.outcome,
        before: r.before, after: r.after, metadata: r.metadata, requestId: r.requestId, ip: r.ip, userAgent: r.userAgent, hash: r.hash,
      })),
      nextCursor: rows.length > q.limit ? String(page[page.length - 1]!.id) : null,
    };
  },

  /** Recomputes the hash chain in the database and reports any altered or missing rows. */
  async verify(actor: Actor) {
    requireRole(actor, 'ADMIN');
    const [count] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM audit_logs`;
    const broken = await prisma.$queryRaw<{ bad_id: bigint; reason: string }[]>`SELECT * FROM audit_verify_chain(0)`;
    return { intact: broken.length === 0, rowsChecked: Number(count?.n ?? 0), broken: broken.slice(0, 20).map((b) => ({ id: String(b.bad_id), reason: b.reason })) };
  },
};

