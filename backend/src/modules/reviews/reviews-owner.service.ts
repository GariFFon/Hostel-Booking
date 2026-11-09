import type { Prisma } from '@/generated/prisma/client';
import { requireRole } from '@/core/auth/rbac';
import type { Actor } from '@/core/context/request-context';
import { Errors, AppError } from '@/core/errors/app-error';
import { cursorArgs, toPage } from '@/core/http/pagination';
import { rateLimit } from '@/core/rate-limit/rate-limit';
import { invalidateHostel } from '@/infra/cache/invalidation';
import { prisma } from '@/infra/db/prisma';
import { recordAudit } from '@/modules/audit/audit.service';
import { notify, notifyAdmins } from '@/modules/notifications/notifications.service';
import { reviewInclude, toOwnerReview, type ReviewFull } from './reviews.mapper';

/** A review of one of the actor's own properties, or "not found". */
async function loadForOwner(db: Prisma.TransactionClient, actor: Actor, reviewId: string): Promise<ReviewFull> {
  requireRole(actor, 'OWNER');
  const r = await db.review.findFirst({ where: { id: reviewId, hostel: { ownerId: actor.id } }, include: reviewInclude });
  if (!r) throw Errors.notFound('Review');
  return r;
}

export const reviewsOwnerService = {
  async list(actor: Actor, q: { limit: number; cursor?: string; hostelId?: string; replied?: 'true' | 'false'; status?: 'PUBLISHED' | 'HIDDEN'; rating?: number }) {
    requireRole(actor, 'OWNER');
    const where: Prisma.ReviewWhereInput = {
      hostel: { ownerId: actor.id, ...(q.hostelId ? { id: q.hostelId } : {}) },
      ...(q.status ? { status: q.status } : {}), ...(q.rating ? { overall: q.rating } : {}),
      ...(q.replied === 'true' ? { ownerReply: { not: null } } : q.replied === 'false' ? { ownerReply: null } : {}),
    };
    const rows = await prisma.review.findMany({ where, include: reviewInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q) });
    const { items, nextCursor } = toPage(rows, q.limit);
    return { items: items.map(toOwnerReview), nextCursor };
  },

  /** Sets or replaces the host's public reply. The guest is told about the first reply only. */
  async reply(actor: Actor, reviewId: string, text: string, now = new Date()) {
    const updated = await prisma.$transaction(async (tx) => {
      const r = await loadForOwner(tx, actor, reviewId);
      if (r.status !== 'PUBLISHED') throw Errors.conflict('This review is not published, so it cannot be answered');
      const row = await tx.review.update({ where: { id: reviewId }, data: { ownerReply: text, ownerRepliedAt: now }, include: reviewInclude });
      await recordAudit({ action: r.ownerReply ? 'review.reply.update' : 'review.reply.create', entityType: 'review', entityId: reviewId, before: { replyLength: r.ownerReply?.length ?? 0 }, after: { replyLength: text.length }, metadata: { hostelId: r.hostelId } }, tx);
      if (!r.ownerReply) await notify({ userId: r.guestId, type: 'REVIEW_REPLIED', title: 'The host replied to your review', body: `${r.hostel.name} responded.`, data: { reviewId, hostelId: r.hostelId } }, tx);
      return row;
    });
    await invalidateHostel(updated.hostelId);
    return toOwnerReview(updated);
  },

  async removeReply(actor: Actor, reviewId: string) {
    const updated = await prisma.$transaction(async (tx) => {
      const r = await loadForOwner(tx, actor, reviewId);
      if (!r.ownerReply) throw Errors.conflict('There is no reply to remove');
      const row = await tx.review.update({ where: { id: reviewId }, data: { ownerReply: null, ownerRepliedAt: null }, include: reviewInclude });
      await recordAudit({ action: 'review.reply.delete', entityType: 'review', entityId: reviewId, before: { replyLength: r.ownerReply.length }, metadata: { hostelId: r.hostelId } }, tx);
      return row;
    });
    await invalidateHostel(updated.hostelId);
    return toOwnerReview(updated);
  },

  /**
   * Hosts cannot hide reviews they dislike; they can ask moderators to look at one that breaks the rules.
   * One report per host per review (a repeat is a 409, not another message to the admins).
   */
  async report(actor: Actor, reviewId: string, reason: string) {
    return prisma.$transaction(async (tx) => {
      const r = await loadForOwner(tx, actor, reviewId);
      if (r.status !== 'PUBLISHED') throw Errors.conflict('This review is already hidden');
      await recordAudit({ action: 'review.report', entityType: 'review', entityId: reviewId, metadata: { hostelId: r.hostelId, reason } }, tx);
      await notifyAdmins({ type: 'SYSTEM', title: 'Review reported by a host', body: `${r.hostel.name}: "${reason.slice(0, 200)}"`, data: { reviewId, hostelId: r.hostelId } }, tx);
      // Claim the once-per-review slot last: a duplicate rolls the writes above back, and a failure above never burns the slot.
      try {
        await rateLimit({ bucket: `review-report:${actor.id}:${reviewId}`, limit: 1, windowSeconds: 7 * 86_400 });
      } catch (e) {
        if (e instanceof AppError && e.code === 'RATE_LIMITED') throw Errors.conflict('You already reported this review. Our moderators will take a look.');
        throw e;
      }
      return { reported: true };
    });
  },
};
