import { Prisma, type Coupon } from '@/generated/prisma/client';
import { requireRole } from '@/core/auth/rbac';
import type { Actor } from '@/core/context/request-context';
import { Errors } from '@/core/errors/app-error';
import { cursorArgs, toPage } from '@/core/http/pagination';
import { cached } from '@/infra/cache/cache';
import { invalidateOffers, ns } from '@/infra/cache/invalidation';
import { prisma } from '@/infra/db/prisma';
import { recordAudit } from '@/modules/audit/audit.service';
import { resolvePublicHostelId } from '@/modules/hostels/public-hostels.service';
import { rupees } from '@/modules/pricing/coupon.rules';
import { COUPON_LIMITS, couponShapeIssues, type updateCouponSchema, type createCouponSchema } from './coupons.schema';
import type { z } from 'zod';

type Role = 'OWNER' | 'ADMIN';
type Tx = Prisma.TransactionClient;
type CouponFull = Coupon & { hostel: { id: string; slug: string; name: string; ownerId: string } | null };
type CreateInput = z.infer<typeof createCouponSchema>;
type UpdateInput = z.infer<typeof updateCouponSchema>;

const include = { hostel: { select: { id: true, slug: true, name: true, ownerId: true } } } satisfies Prisma.CouponInclude;
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export type CouponStatus = 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'EXHAUSTED' | 'DISABLED';
export function couponStatus(c: Pick<Coupon, 'isActive' | 'validFrom' | 'validTo' | 'usageLimit' | 'usedCount'>, now: Date): CouponStatus {
  if (!c.isActive) return 'DISABLED';
  if (now > c.validTo) return 'EXPIRED';
  if (now < c.validFrom) return 'SCHEDULED';
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit) return 'EXHAUSTED';
  return 'ACTIVE';
}

const toDto = (c: CouponFull, redeemedPaise: number, now: Date) => ({
  id: c.id, code: c.code, description: c.description, discountType: c.discountType, percentBps: c.percentBps, flatPaise: c.flatPaise, maxDiscountPaise: c.maxDiscountPaise, minBookingPaise: c.minBookingPaise,
  scope: (c.hostelId ? 'PROPERTY' : 'PLATFORM') as 'PLATFORM' | 'PROPERTY',
  hostel: c.hostel ? { id: c.hostel.id, slug: c.hostel.slug, name: c.hostel.name } : null,
  validFrom: c.validFrom.toISOString(), validTo: c.validTo.toISOString(),
  usageLimit: c.usageLimit, usedCount: c.usedCount, remaining: c.usageLimit === null ? null : Math.max(0, c.usageLimit - c.usedCount), perUserLimit: c.perUserLimit,
  isActive: c.isActive, isPublic: c.isPublic, status: couponStatus(c, now), redeemedPaise,
  createdById: c.createdById, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
});

const auditView = (c: CouponFull) => ({
  code: c.code, discountType: c.discountType, percentBps: c.percentBps, flatPaise: c.flatPaise, maxDiscountPaise: c.maxDiscountPaise, minBookingPaise: c.minBookingPaise,
  hostelId: c.hostelId, validFrom: c.validFrom.toISOString(), validTo: c.validTo.toISOString(), usageLimit: c.usageLimit, perUserLimit: c.perUserLimit, isActive: c.isActive, isPublic: c.isPublic,
});

async function redeemed(db: Tx, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db.couponRedemption.groupBy({ by: ['couponId'], where: { couponId: { in: ids } }, _sum: { amountPaise: true } });
  return new Map(rows.map((r) => [r.couponId, r._sum.amountPaise ?? 0]));
}

/** Hosts see and change only coupons on their own (undeleted) properties; admins see everything. */
const visibleTo = (actor: Actor, role: Role): Prisma.CouponWhereInput => (role === 'OWNER' ? { hostel: { ownerId: actor.id, deletedAt: null } } : {});

async function load(db: Tx, actor: Actor, role: Role, id: string): Promise<CouponFull> {
  requireRole(actor, role);
  const c = await db.coupon.findFirst({ where: { id, ...visibleTo(actor, role) }, include });
  if (!c) throw Errors.notFound('Coupon');
  return c;
}

/** Row lock: bookings re-validate a coupon under this same lock, so edits and redemptions never interleave. */
const lock = (db: Tx, id: string) => db.$queryRaw`SELECT id FROM coupons WHERE id = ${id}::uuid FOR UPDATE`;

const fmtOffer = (c: Pick<Coupon, 'discountType' | 'percentBps' | 'flatPaise' | 'maxDiscountPaise' | 'minBookingPaise'>) => {
  const what = c.discountType === 'PERCENT' ? `${(c.percentBps ?? 0) / 100}% off${c.maxDiscountPaise ? ` up to ${rupees(c.maxDiscountPaise)}` : ''}` : `${rupees(c.flatPaise ?? 0)} off`;
  return c.minBookingPaise > 0 ? `${what} on bookings of ${rupees(c.minBookingPaise)} or more` : what;
};

export const couponsService = {
  async list(actor: Actor, role: Role, q: { limit: number; cursor?: string; hostelId?: string; isActive?: 'true' | 'false'; scope?: 'PLATFORM' | 'PROPERTY' }, now = new Date()) {
    requireRole(actor, role);
    const where: Prisma.CouponWhereInput = {
      ...visibleTo(actor, role),
      ...(q.hostelId ? { hostelId: q.hostelId } : {}),
      ...(q.isActive ? { isActive: q.isActive === 'true' } : {}),
      ...(role === 'ADMIN' && q.scope ? { hostelId: q.scope === 'PLATFORM' ? null : { not: null } } : {}),
    };
    const rows = await prisma.coupon.findMany({ where, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q) });
    const { items, nextCursor } = toPage(rows, q.limit);
    const sums = await redeemed(prisma, items.map((c) => c.id));
    return { items: items.map((c) => toDto(c, sums.get(c.id) ?? 0, now)), nextCursor };
  },

  async get(actor: Actor, role: Role, id: string, now = new Date()) {
    const c = await load(prisma, actor, role, id);
    return toDto(c, (await redeemed(prisma, [id])).get(id) ?? 0, now);
  },

  async create(actor: Actor, role: Role, input: CreateInput, now = new Date()) {
    requireRole(actor, role);
    const validFrom = new Date(input.validFrom), validTo = new Date(input.validTo);
    if (validTo <= now) throw Errors.validation([{ path: 'validTo', message: 'Must be in the future' }]);
    if (role === 'OWNER' && !input.hostelId) throw Errors.validation([{ path: 'hostelId', message: 'Choose the property this code applies to' }]);
    // Platform-wide codes are funded by the platform and are an admin tool; the ledger treats "no property" as platform-funded.
    if (role === 'ADMIN' && input.hostelId) throw Errors.validation([{ path: 'hostelId', message: 'Admin coupons are platform-wide. Hosts create codes for their own properties.' }]);

    const created = await prisma.$transaction(async (tx) => {
      if (input.hostelId) {
        const h = await tx.hostel.findFirst({ where: { id: input.hostelId, deletedAt: null, ...(role === 'OWNER' ? { ownerId: actor.id } : {}) }, select: { id: true } });
        if (!h) throw Errors.notFound('Hostel');
      }
      if (role === 'OWNER' && (await tx.coupon.count({ where: { hostel: { ownerId: actor.id } } })) >= COUPON_LIMITS.maxPerOwner) {
        throw Errors.conflict(`You can have at most ${COUPON_LIMITS.maxPerOwner} coupons. Delete or reuse old ones.`);
      }
      let c: CouponFull;
      try {
        c = await tx.coupon.create({
          data: {
            code: input.code.toUpperCase(), description: input.description ?? null, discountType: input.discountType, percentBps: input.percentBps ?? null, flatPaise: input.flatPaise ?? null,
            maxDiscountPaise: input.maxDiscountPaise ?? null, minBookingPaise: input.minBookingPaise, hostelId: input.hostelId ?? null, createdById: actor.id, validFrom, validTo,
            usageLimit: input.usageLimit ?? null, perUserLimit: input.perUserLimit, isActive: input.isActive, isPublic: input.isPublic,
          },
          include,
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw Errors.conflict('This code is already taken. Choose another.');
        throw e;
      }
      await recordAudit({ action: 'coupon.create', entityType: 'coupon', entityId: c.id, after: auditView(c) }, tx);
      return c;
    });
    await invalidateOffers();
    return toDto(created, 0, now);
  },

  async update(actor: Actor, role: Role, id: string, patch: UpdateInput, now = new Date()) {
    requireRole(actor, role);
    const result = await prisma.$transaction(async (tx) => {
      await load(tx, actor, role, id);
      await lock(tx, id);
      const current = await load(tx, actor, role, id); // re-read under the lock

      // Hosts set the terms of their own codes. Admins moderate them: they may switch one off or off the public list, not rewrite it.
      if (role === 'ADMIN' && current.hostelId !== null && Object.keys(patch).some((k) => k !== 'isActive' && k !== 'isPublic')) {
        throw Errors.forbidden('Only the host can change the terms of a property coupon. You can deactivate it.');
      }

      const merged = {
        ...current,
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.percentBps !== undefined ? { percentBps: patch.percentBps } : {}), ...(patch.flatPaise !== undefined ? { flatPaise: patch.flatPaise } : {}),
        ...(patch.maxDiscountPaise !== undefined ? { maxDiscountPaise: patch.maxDiscountPaise } : {}), ...(patch.minBookingPaise !== undefined ? { minBookingPaise: patch.minBookingPaise } : {}),
        ...(patch.validFrom ? { validFrom: new Date(patch.validFrom) } : {}), ...(patch.validTo ? { validTo: new Date(patch.validTo) } : {}),
        ...(patch.usageLimit !== undefined ? { usageLimit: patch.usageLimit } : {}), ...(patch.perUserLimit !== undefined ? { perUserLimit: patch.perUserLimit } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}), ...(patch.isPublic !== undefined ? { isPublic: patch.isPublic } : {}),
      };
      const issues = couponShapeIssues(merged);
      if (merged.usageLimit !== null && merged.usageLimit < current.usedCount) issues.push({ path: 'usageLimit', message: `Cannot be lower than the ${current.usedCount} time(s) it is already in use` });
      if (issues.length) throw Errors.validation(issues);

      const updated = await tx.coupon.update({
        where: { id },
        data: {
          description: merged.description, percentBps: merged.percentBps, flatPaise: merged.flatPaise, maxDiscountPaise: merged.maxDiscountPaise, minBookingPaise: merged.minBookingPaise,
          validFrom: merged.validFrom, validTo: merged.validTo, usageLimit: merged.usageLimit, perUserLimit: merged.perUserLimit, isActive: merged.isActive, isPublic: merged.isPublic,
        },
        include,
      });
      await recordAudit({ action: 'coupon.update', entityType: 'coupon', entityId: id, before: auditView(current), after: auditView(updated) }, tx);
      return { updated, redeemedPaise: (await redeemed(tx, [id])).get(id) ?? 0 };
    });
    await invalidateOffers();
    return toDto(result.updated, result.redeemedPaise, now);
  },

  /** A code that was ever used stays (bookings and the ledger point at it): deactivate it instead. */
  async remove(actor: Actor, role: Role, id: string) {
    requireRole(actor, role);
    await prisma.$transaction(async (tx) => {
      await load(tx, actor, role, id);
      await lock(tx, id);
      const current = await load(tx, actor, role, id);
      const uses = current.usedCount + (await tx.booking.count({ where: { couponId: id } })) + (await tx.couponRedemption.count({ where: { couponId: id } }));
      if (uses > 0) throw Errors.conflict('This code has been used, so it cannot be deleted. Deactivate it instead.');
      await tx.coupon.delete({ where: { id } });
      await recordAudit({ action: 'coupon.delete', entityType: 'coupon', entityId: id, before: auditView(current) }, tx);
    });
    await invalidateOffers();
  },

  // ───────────── public ─────────────
  /** Public, currently valid, not fully redeemed codes for a listing (its own plus platform-wide). Terms are re-checked at quote time. */
  async offers(idOrSlug: string) {
    const hostelId = await resolvePublicHostelId(idOrSlug);
    const { value, hit } = await cached({ ns: [ns.hostel(hostelId), ns.offers], key: 'offers', ttlSeconds: 60 }, async () => {
      const now = new Date();
      const rows = await prisma.coupon.findMany({
        where: { isActive: true, isPublic: true, validFrom: { lte: now }, validTo: { gte: now }, OR: [{ hostelId }, { hostelId: null }] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50,
      });
      return rows
        .filter((c) => c.usageLimit === null || c.usedCount < c.usageLimit)
        .slice(0, 20)
        .map((c) => ({
          code: c.code, description: c.description, headline: fmtOffer(c), discountType: c.discountType, percentBps: c.percentBps, flatPaise: c.flatPaise, maxDiscountPaise: c.maxDiscountPaise,
          minBookingPaise: c.minBookingPaise, scope: (c.hostelId ? 'PROPERTY' : 'PLATFORM') as 'PLATFORM' | 'PROPERTY', validTo: c.validTo.toISOString(),
        }));
    });
    return { offers: value, hit };
  },
};
