import type { Actor } from '@/core/context/request-context';
import { Errors } from '@/core/errors/app-error';
import { prisma } from '@/infra/db/prisma';
import { transformUrl } from '@/infra/cloudinary/storage';

export const MAX_WISHLIST = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only approved, undeleted listings are visible to guests; saved rows for listings that go offline come back if they are reinstated. */
const VISIBLE = { status: 'APPROVED', deletedAt: null } as const;

export const wishlistService = {
  /** Newest saved first. Keyset cursor = the last item's hostel id (the primary key is (user, hostel)). */
  async list(actor: Actor, q: { limit: number; cursor?: string }) {
    const hostelId = q.cursor ? Buffer.from(q.cursor, 'base64url').toString() : null;
    const rows = await prisma.wishlist.findMany({
      where: { userId: actor.id, hostel: VISIBLE },
      include: { hostel: { include: { media: { where: { deletedAt: null, roomTypeId: null }, orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }], take: 1 } } } },
      orderBy: [{ createdAt: 'desc' }, { hostelId: 'desc' }],
      take: q.limit + 1,
      ...(hostelId && UUID.test(hostelId) ? { cursor: { userId_hostelId: { userId: actor.id, hostelId } }, skip: 1 } : {}),
    });
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const items = page.map((w) => {
      const h = w.hostel;
      const cover = h.media[0];
      return {
        savedAt: w.createdAt.toISOString(),
        hostel: {
          id: h.id, slug: h.slug, name: h.name, propertyType: h.propertyType, city: h.city, state: h.state, locality: h.locality,
          coverUrl: cover ? transformUrl(cover.url, 'c_fill,w_640,h_480,f_auto,q_auto') : null,
          fromPricePaise: h.minPricePaise, currency: h.currency, avgRating: h.avgRating, reviewCount: h.reviewCount, bookingMode: h.bookingMode, genderPolicy: h.genderPolicy,
        },
      };
    });
    return { items, nextCursor: hasMore ? Buffer.from(page[page.length - 1]!.hostelId).toString('base64url') : null };
  },

  async ids(actor: Actor) {
    const rows = await prisma.wishlist.findMany({ where: { userId: actor.id, hostel: VISIBLE }, select: { hostelId: true }, orderBy: [{ createdAt: 'desc' }, { hostelId: 'desc' }], take: MAX_WISHLIST });
    return { hostelIds: rows.map((r) => r.hostelId) };
  },

  /** Idempotent: saving something already saved succeeds and changes nothing. */
  async add(actor: Actor, hostelId: string, max = MAX_WISHLIST) {
    const hostel = await prisma.hostel.findFirst({ where: { id: hostelId, ...VISIBLE }, select: { id: true } });
    if (!hostel) throw Errors.notFound('Hostel');
    await prisma.$transaction(async (tx) => {
      const exists = await tx.wishlist.findUnique({ where: { userId_hostelId: { userId: actor.id, hostelId } }, select: { hostelId: true } });
      if (exists) return;
      if ((await tx.wishlist.count({ where: { userId: actor.id } })) >= max) throw Errors.conflict(`You can save up to ${max} properties`);
      // A concurrent duplicate insert is harmless: skipDuplicates turns it into a no-op instead of a unique violation.
      await tx.wishlist.createMany({ data: [{ userId: actor.id, hostelId }], skipDuplicates: true });
    });
    return { hostelId, saved: true };
  },

  /** Idempotent: removing something not saved (or no longer listed) succeeds. */
  async remove(actor: Actor, hostelId: string) {
    await prisma.wishlist.deleteMany({ where: { userId: actor.id, hostelId } });
    return { hostelId, saved: false };
  },
};
