import { Prisma } from '@/generated/prisma/client';
import type { Actor } from '@/core/context/request-context';
import { addDays, toDateString, todayIn } from '@/core/dates';
import { Errors } from '@/core/errors/app-error';
import { cursorArgs, toPage } from '@/core/http/pagination';
import { cached } from '@/infra/cache/cache';
import { invalidateHostel, ns } from '@/infra/cache/invalidation';
import { prisma } from '@/infra/db/prisma';
import { recordAudit } from '@/modules/audit/audit.service';
import { resolvePublicHostelId } from '@/modules/hostels/public-hostels.service';
import { notify } from '@/modules/notifications/notifications.service';
import { REVIEW_WINDOW_DAYS } from './reviews.config';
import { auditSnapshot, editableUntil, reviewInclude, toMyReview, toPublicReview, type ReviewFull } from './reviews.mapper';
import { lockHostelForRating, recomputeRating } from './reviews.rating';
import type { createReviewSchema, updateReviewSchema } from './reviews.schema';
import type { z } from 'zod';

type CreateInput = z.infer<typeof createReviewSchema>;
type UpdateInput = z.infer<typeof updateReviewSchema>;

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

const PUBLIC_TTL_SECONDS = 120;

type Sort = 'recent' | 'highest' | 'lowest';
const ORDER: Record<Sort, Prisma.ReviewOrderByWithRelationInput[]> = {
  recent: [{ createdAt: 'desc' }, { id: 'desc' }],
  highest: [{ overall: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  lowest: [{ overall: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
};

/** A guest's own review, or "not found" (someone else's review is indistinguishable from a missing one). */
async function loadOwn(db: Prisma.TransactionClient, actor: Actor, reviewId: string): Promise<ReviewFull> {
  const r = await db.review.findFirst({ where: { id: reviewId, guestId: actor.id }, include: reviewInclude });
  if (!r) throw Errors.notFound('Review');
  return r;
}

function assertEditable(r: ReviewFull, now: Date, verb: 'edit' | 'delete') {
  if (r.status === 'HIDDEN') throw Errors.conflict(`This review was removed by our moderators and cannot be ${verb === 'edit' ? 'edited' : 'deleted'}`);
  if (r.ownerReply) throw Errors.conflict(`The host has replied to this review, so it can no longer be ${verb === 'edit' ? 'edited' : 'deleted'}`);
  if (!editableUntil(r, now)) throw Errors.conflict(`Reviews can only be ${verb === 'edit' ? 'edited' : 'deleted'} for a short time after posting`);
}

export const reviewsService = {
  // ───────────── guest ─────────────
  async create(actor: Actor, bookingId: string, input: CreateInput, now = new Date()) {
    const review = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.findFirst({ where: { id: bookingId, guestId: actor.id }, include: { hostel: { select: { id: true, name: true, ownerId: true, timezone: true } } } });
      if (!b) throw Errors.notFound('Booking');
      if (b.hostel.ownerId === actor.id) throw Errors.forbidden('You cannot review your own property');
      if (b.status !== 'COMPLETED') throw Errors.conflict('You can review a stay once it is completed');
      if (todayIn(b.hostel.timezone, now) > addDays(toDateString(b.checkOut), REVIEW_WINDOW_DAYS)) throw Errors.conflict(`Reviews can be posted for ${REVIEW_WINDOW_DAYS} days after check-out`);

      await lockHostelForRating(tx, b.hostelId);
      if (await tx.review.findUnique({ where: { bookingId }, select: { id: true } })) throw Errors.conflict('You have already reviewed this stay');

      let created;
      try {
        created = await tx.review.create({ data: { bookingId, hostelId: b.hostelId, guestId: actor.id, ...input }, include: reviewInclude });
      } catch (e) {
        if (isUniqueViolation(e)) throw Errors.conflict('You have already reviewed this stay');
        throw e;
      }
      await recomputeRating(tx, b.hostelId);
      await recordAudit({ action: 'review.create', entityType: 'review', entityId: created.id, after: { ...auditSnapshot(created), hostelId: b.hostelId, bookingId } }, tx);
      await notify({ userId: b.hostel.ownerId, type: 'REVIEW_RECEIVED', title: `New ${input.overall}-star review`, body: `A guest reviewed ${b.hostel.name}.`, data: { reviewId: created.id, hostelId: b.hostelId } }, tx);
      return created;
    });
    await invalidateHostel(review.hostelId);
    return toMyReview(review, now);
  },

  async update(actor: Actor, reviewId: string, patch: UpdateInput, now = new Date()) {
    const result = await prisma.$transaction(async (tx) => {
      const current = await loadOwn(tx, actor, reviewId);
      await lockHostelForRating(tx, current.hostelId);
      const locked = await loadOwn(tx, actor, reviewId); // re-read under the lock: a host reply or moderation may have landed meanwhile
      assertEditable(locked, now, 'edit');
      const updated = await tx.review.update({ where: { id: reviewId }, data: { ...patch, editedAt: now }, include: reviewInclude });
      await recomputeRating(tx, locked.hostelId);
      await recordAudit({ action: 'review.update', entityType: 'review', entityId: reviewId, before: auditSnapshot(locked), after: auditSnapshot(updated) }, tx);
      return updated;
    });
    await invalidateHostel(result.hostelId);
    return toMyReview(result, now);
  },

  async remove(actor: Actor, reviewId: string, now = new Date()) {
    const hostelId = await prisma.$transaction(async (tx) => {
      const current = await loadOwn(tx, actor, reviewId);
      await lockHostelForRating(tx, current.hostelId);
      const locked = await loadOwn(tx, actor, reviewId);
      assertEditable(locked, now, 'delete');
      await tx.review.delete({ where: { id: reviewId } });
      await recomputeRating(tx, locked.hostelId);
      await recordAudit({ action: 'review.delete', entityType: 'review', entityId: reviewId, before: { ...auditSnapshot(locked), hostelId: locked.hostelId, bookingId: locked.bookingId } }, tx);
      return locked.hostelId;
    });
    await invalidateHostel(hostelId);
  },

  async listMine(actor: Actor, q: { limit: number; cursor?: string }, now = new Date()) {
    const rows = await prisma.review.findMany({ where: { guestId: actor.id }, include: reviewInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q) });
    const { items, nextCursor } = toPage(rows, q.limit);
    return { items: items.map((r) => toMyReview(r, now)), nextCursor };
  },

  // ───────────── public ─────────────
  /** Published reviews of an approved listing. Cached per page/sort/filter; any review or listing change invalidates it. */
  async listPublic(idOrSlug: string, q: { limit: number; cursor?: string; sort: Sort; rating?: number }) {
    const hostelId = await resolvePublicHostelId(idOrSlug);
    const { value, hit } = await cached({ ns: [ns.hostel(hostelId)], key: `reviews:${q.sort}:${q.rating ?? 'all'}:${q.limit}:${q.cursor ?? ''}`, ttlSeconds: PUBLIC_TTL_SECONDS }, async () => {
      const rows = await prisma.review.findMany({
        where: { hostelId, status: 'PUBLISHED', ...(q.rating ? { overall: q.rating } : {}) },
        include: reviewInclude, orderBy: ORDER[q.sort], ...cursorArgs(q),
      });
      const { items, nextCursor } = toPage(rows, q.limit);
      return { items: items.map(toPublicReview), nextCursor };
    });
    return { ...value, hit };
  },

  async summary(idOrSlug: string) {
    const hostelId = await resolvePublicHostelId(idOrSlug);
    const { value, hit } = await cached({ ns: [ns.hostel(hostelId)], key: 'reviews:summary', ttlSeconds: PUBLIC_TTL_SECONDS }, async () => {
      const where: Prisma.ReviewWhereInput = { hostelId, status: 'PUBLISHED' };
      const [byRating, agg] = await Promise.all([
        prisma.review.groupBy({ by: ['overall'], where, _count: { _all: true } }),
        prisma.review.aggregate({ where, _avg: { overall: true, cleanliness: true, location: true, staff: true, valueForMoney: true }, _count: { _all: true } }),
      ]);
      const count = (n: number) => byRating.find((g) => g.overall === n)?._count._all ?? 0;
      const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
      return {
        avgRating: r2(agg._avg.overall) ?? 0, reviewCount: agg._count._all,
        distribution: { '1': count(1), '2': count(2), '3': count(3), '4': count(4), '5': count(5) },
        categories: { cleanliness: r2(agg._avg.cleanliness), location: r2(agg._avg.location), staff: r2(agg._avg.staff), valueForMoney: r2(agg._avg.valueForMoney) },
      };
    });
    return { dto: value, hit };
  },
};
