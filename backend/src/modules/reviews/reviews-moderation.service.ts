import type { Prisma } from '@/generated/prisma/client';
import { requireRole } from '@/core/auth/rbac';
import type { Actor } from '@/core/context/request-context';
import { Errors } from '@/core/errors/app-error';
import { cursorArgs, toPage } from '@/core/http/pagination';
import { invalidateHostel } from '@/infra/cache/invalidation';
import { prisma } from '@/infra/db/prisma';
import { recordAudit } from '@/modules/audit/audit.service';
import { notify } from '@/modules/notifications/notifications.service';
import { auditSnapshot, reviewInclude, toAdminReview } from './reviews.mapper';
import { lockHostelForRating, recomputeRating } from './reviews.rating';

export const reviewsModerationService = {
  async list(actor: Actor, q: { limit: number; cursor?: string; status?: 'PUBLISHED' | 'HIDDEN'; hostelId?: string; rating?: number }) {
    requireRole(actor, 'ADMIN');
    const where: Prisma.ReviewWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.hostelId ? { hostelId: q.hostelId } : {}), ...(q.rating ? { overall: q.rating } : {}) };
    const rows = await prisma.review.findMany({ where, include: reviewInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q) });
    const { items, nextCursor } = toPage(rows, q.limit);
    return { items: items.map(toAdminReview), nextCursor };
  },

  async hide(actor: Actor, reviewId: string, reason: string, now = new Date()) {
    requireRole(actor, 'ADMIN');
    const updated = await prisma.$transaction(async (tx) => {
      const found = await tx.review.findUnique({ where: { id: reviewId }, select: { hostelId: true } });
      if (!found) throw Errors.notFound('Review');
      await lockHostelForRating(tx, found.hostelId);
      const r = await tx.review.findUniqueOrThrow({ where: { id: reviewId }, include: reviewInclude });
      if (r.status === 'HIDDEN') throw Errors.invalidTransition('HIDDEN', 'HIDDEN');
      const row = await tx.review.update({ where: { id: reviewId }, data: { status: 'HIDDEN', moderationReason: reason, moderatedById: actor.id, moderatedAt: now }, include: reviewInclude });
      await recomputeRating(tx, r.hostelId);
      await recordAudit({ action: 'review.hide', entityType: 'review', entityId: reviewId, before: auditSnapshot(r), after: auditSnapshot(row), metadata: { hostelId: r.hostelId, reason } }, tx);
      await notify({ userId: r.guestId, type: 'SYSTEM', title: 'Your review was removed', body: `Your review of ${r.hostel.name} breaks our content rules and is no longer public. Reason: ${reason}`, data: { reviewId, hostelId: r.hostelId } }, tx);
      return row;
    });
    await invalidateHostel(updated.hostelId);
    return toAdminReview(updated);
  },

  async restore(actor: Actor, reviewId: string, now = new Date()) {
    requireRole(actor, 'ADMIN');
    const updated = await prisma.$transaction(async (tx) => {
      const found = await tx.review.findUnique({ where: { id: reviewId }, select: { hostelId: true } });
      if (!found) throw Errors.notFound('Review');
      await lockHostelForRating(tx, found.hostelId);
      const r = await tx.review.findUniqueOrThrow({ where: { id: reviewId }, include: reviewInclude });
      if (r.status === 'PUBLISHED') throw Errors.invalidTransition('PUBLISHED', 'PUBLISHED');
      const row = await tx.review.update({ where: { id: reviewId }, data: { status: 'PUBLISHED', moderationReason: null, moderatedById: actor.id, moderatedAt: now }, include: reviewInclude });
      await recomputeRating(tx, r.hostelId);
      await recordAudit({ action: 'review.restore', entityType: 'review', entityId: reviewId, before: auditSnapshot(r), after: auditSnapshot(row), metadata: { hostelId: r.hostelId } }, tx);
      await notify({ userId: r.guestId, type: 'SYSTEM', title: 'Your review is public again', body: `Your review of ${r.hostel.name} was reinstated after a moderator took another look.`, data: { reviewId, hostelId: r.hostelId } }, tx);
      return row;
    });
    await invalidateHostel(updated.hostelId);
    return toAdminReview(updated);
  },
};
