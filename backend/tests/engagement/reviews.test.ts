import { beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { redis } from '@/infra/redis/redis';
import { GET as getBooking } from '@/app/api/v1/bookings/[id]/route';
import { GET as getOwnerBooking } from '@/app/api/v1/owner/bookings/[id]/route';
import { POST as guestCancel } from '@/app/api/v1/bookings/[id]/cancel/route';
import { POST as createReview } from '@/app/api/v1/bookings/[id]/review/route';
import { GET as myReviews } from '@/app/api/v1/me/reviews/route';
import { DELETE as deleteReview, PATCH as patchReview } from '@/app/api/v1/reviews/[id]/route';
import { GET as publicReviews } from '@/app/api/v1/hostels/[idOrSlug]/reviews/route';
import { GET as reviewSummary } from '@/app/api/v1/hostels/[idOrSlug]/reviews/summary/route';
import { GET as publicHostel } from '@/app/api/v1/hostels/[idOrSlug]/route';
import { GET as ownerReviews } from '@/app/api/v1/owner/reviews/route';
import { DELETE as removeReply, PUT as putReply } from '@/app/api/v1/owner/reviews/[id]/reply/route';
import { POST as reportReview } from '@/app/api/v1/owner/reviews/[id]/report/route';
import { GET as adminReviews } from '@/app/api/v1/admin/reviews/route';
import { POST as hideReview } from '@/app/api/v1/admin/reviews/[id]/hide/route';
import { POST as restoreReview } from '@/app/api/v1/admin/reviews/[id]/restore/route';
import { handlers } from '@/jobs/handlers';
import { reviewsModerationService } from '@/modules/reviews/reviews-moderation.service';
import { reviewerName } from '@/modules/reviews/reviews.mapper';
import { reconcileRatings } from '@/modules/reviews/reviews.rating';
import { REVIEW_EDIT_WINDOW_DAYS, REVIEW_WINDOW_DAYS } from '@/modules/reviews/reviews.config';
import { adminReviewSchema, myReviewSchema, ownerReviewSchema, publicReviewSchema, reviewSummarySchema } from '@/modules/reviews/reviews.schema';
import { reviewsService } from '@/modules/reviews/reviews.service';
import { bookingDtoSchema } from '@/modules/bookings/bookings.schema';
import { call } from '../helpers/http';
import { confirmedBooking, makeGuest, makeHost, notificationsFor } from '../helpers/booking';
import { actorOf, at, completedRow, completedStay, issues, makeAdmin, seedReview } from '../helpers/engagement';
import { TODAY } from '../helpers/publish';
import { makeUser } from '../helpers/users';

beforeAll(async () => {
  await redis.flushdb();
});

const PRICE = { rooms: [{ units: 6, price: 80000 }] };
const FULL = { overall: 5, cleanliness: 4, location: 5, staff: 5, valueForMoney: 4, title: 'Lovely stay', comment: 'Clean dorms and friendly staff.' };
const read = (token: string, id: string) => call(getBooking, { method: 'GET', token, params: { id } });
const hostelRow = (id: string) => prisma.hostel.findUniqueOrThrow({ where: { id }, select: { avgRating: true, reviewCount: true } });
const expectedFromRows = async (hostelId: string) => {
  const agg = await prisma.review.aggregate({ where: { hostelId, status: 'PUBLISHED' }, _avg: { overall: true }, _count: true });
  return { avgRating: Math.round((agg._avg.overall ?? 0) * 100) / 100, reviewCount: agg._count };
};

describe('reviewerName', () => {
  it.each([
    ['Asha Rao', 'Asha R.'], ['Cher', 'Cher'], ['  Jean   Luc  Picard ', 'Jean P.'], ['', 'Guest'], [null, 'Guest'], [undefined, 'Guest'], ['   ', 'Guest'],
    ['😀 Smith', '😀 S.'], ['Åsa Öberg', 'Åsa Ö.'], ['A'.repeat(80), 'A'.repeat(30)],
  ])('%j -> %j (first name plus last initial, never the full name)', (input, expected) => {
    expect(reviewerName(input as string | null | undefined)).toBe(expected);
  });
});

describe('writing a review', () => {
  it('a completed stay can be reviewed once: rating recomputed, host notified, caches fresh, no review text in the audit log', async () => {
    const host = await makeHost(PRICE);
    const guest = await makeGuest();
    const id = await completedStay(host, guest);

    // warm the public caches first: the new review must show up immediately afterwards
    expect((await call(publicHostel, { method: 'GET', params: { idOrSlug: host.hostel.id } })).body.data).toMatchObject({ avgRating: 0, reviewCount: 0 });
    expect((await call(reviewSummary, { method: 'GET', params: { idOrSlug: host.hostel.id } })).body.data.reviewCount).toBe(0);

    const before = await read(guest.token, id);
    expect(before.body.data.actions).toContain('review');
    expect(before.body.data.reviewId).toBeNull();

    const res = await call(createReview, { token: guest.token, params: { id }, body: { ...FULL, comment: 'Clean dorms. Secret-comment-xyz' } });
    expect(res.status).toBe(201);
    expect(issues(myReviewSchema, res.body.data)).toEqual([]);
    expect(res.body.data).toMatchObject({ overall: 5, cleanliness: 4, status: 'PUBLISHED', bookingId: id, editable: true, editedAt: null, ownerReply: null, reviewer: { name: 'Test P.' }, hostel: { id: host.hostel.id } });
    expect(res.body.data.stay).toEqual({ month: TODAY.slice(0, 7), nights: 2 });

    expect(await hostelRow(host.hostel.id)).toEqual({ avgRating: 5, reviewCount: 1 });
    const pub = await call(publicHostel, { method: 'GET', params: { idOrSlug: host.hostel.id } });
    expect(pub.body.data).toMatchObject({ avgRating: 5, reviewCount: 1 });

    const after = await read(guest.token, id);
    expect(after.body.data.reviewId).toBe(res.body.data.id);
    expect(after.body.data.actions).not.toContain('review');
    expect(issues(bookingDtoSchema, after.body.data)).toEqual([]);
    expect((await call(getOwnerBooking, { method: 'GET', token: host.owner.token, params: { id } })).body.data).toMatchObject({ viewer: 'OWNER', reviewId: null }); // the host's view of the booking does not carry it

    expect((await notificationsFor(host.owner.id)).filter((n) => n.type === 'REVIEW_RECEIVED')).toHaveLength(1);
    const audits = await prisma.auditLog.findMany({ where: { entityType: 'review', entityId: res.body.data.id } });
    expect(audits.map((a) => a.action)).toEqual(['review.create']);
    expect(JSON.stringify(audits.map((a) => [a.before, a.after, a.metadata]))).not.toContain('Secret-comment-xyz'); // permanent log: ratings and lengths only
    expect(audits[0]!.after).toMatchObject({ overall: 5, commentLength: 'Clean dorms. Secret-comment-xyz'.length });
  });

  it('only the booking guest, only a completed stay, only once', async () => {
    const host = await makeHost(PRICE);
    const guest = await makeGuest();
    const other = await makeGuest();
    const done = await completedStay(host, guest);

    expect((await call(createReview, { token: other.token, params: { id: done }, body: FULL })).status).toBe(404); // someone else's booking is "not found"
    expect((await call(createReview, { params: { id: done }, body: FULL })).status).toBe(401);
    expect((await call(createReview, { token: guest.token, params: { id: 'not-a-uuid' }, body: FULL })).status).toBe(404);

    const upcoming = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id); // paid, stay is in 20 days
    const early = await call(createReview, { token: guest.token, params: { id: upcoming }, body: FULL });
    expect(early.status).toBe(409);
    expect(early.body.error.message).toMatch(/completed/i);
    expect((await read(guest.token, upcoming)).body.data.actions).not.toContain('review');

    await call(guestCancel, { token: guest.token, params: { id: upcoming }, body: {} });
    expect((await call(createReview, { token: guest.token, params: { id: upcoming }, body: FULL })).status).toBe(409); // cancelled

    expect((await call(createReview, { token: guest.token, params: { id: done }, body: FULL })).status).toBe(201);
    const dup = await call(createReview, { token: guest.token, params: { id: done }, body: { overall: 1 } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/already reviewed/i);
    expect(await prisma.review.count({ where: { bookingId: done } })).toBe(1);
  });

  it('a host cannot review their own property', async () => {
    const host = await makeHost(PRICE);
    const b = await completedRow(host.hostel.id, host.owner.id); // cannot happen through the booking API; guard anyway
    const res = await call(createReview, { token: host.owner.token, params: { id: b.id }, body: FULL });
    expect(res.status).toBe(403);
    expect(await prisma.review.count({ where: { bookingId: b.id } })).toBe(0);
  });

  it(`closes ${REVIEW_WINDOW_DAYS} days after check-out (hostel time)`, async () => {
    const host = await makeHost(PRICE);
    const guest = await makeGuest();
    const late = await completedStay(host, guest); // check-out: today + 2
    const lastDay = at(addDays(TODAY, 2 + REVIEW_WINDOW_DAYS));
    const tooLate = at(addDays(TODAY, 2 + REVIEW_WINDOW_DAYS + 1));
    await expect(reviewsService.create(actorOf(guest, 'GUEST'), late, { overall: 4 }, tooLate)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await prisma.review.count({ where: { bookingId: late } })).toBe(0);
    await expect(reviewsService.create(actorOf(guest, 'GUEST'), late, { overall: 4 }, lastDay)).resolves.toMatchObject({ overall: 4 });
  });

  it.each([
    ['overall missing', {}],
    ['overall 0', { overall: 0 }], ['overall 6', { overall: 6 }], ['overall 4.5', { overall: 4.5 }], ['overall as text', { overall: '5' }],
    ['category 0', { overall: 4, staff: 0 }], ['category 9', { overall: 4, location: 9 }],
    ['blank title', { overall: 4, title: '   ' }], ['title too long', { overall: 4, title: 'x'.repeat(101) }],
    ['blank comment', { overall: 4, comment: '' }], ['comment too long', { overall: 4, comment: 'x'.repeat(2001) }],
    ['NUL in comment', { overall: 4, comment: 'bad\u0000text' }], ['escape char in title', { overall: 4, title: 'a\u001bb' }],
    ['unknown field', { overall: 4, status: 'HIDDEN' }], ['smuggled owner reply', { overall: 4, ownerReply: 'hi' }], ['smuggled hostel', { overall: 4, hostelId: '00000000-0000-4000-8000-000000000000' }],
  ])('rejects %s with 422 and writes nothing', async (_name, body) => {
    const host = await makeHost(PRICE);
    const guest = await makeGuest();
    const id = await completedStay(host, guest);
    const res = await call(createReview, { token: guest.token, params: { id }, body });
    expect(res.status).toBe(422);
    expect(await prisma.review.count({ where: { bookingId: id } })).toBe(0);
    expect(await hostelRow(host.hostel.id)).toEqual({ avgRating: 0, reviewCount: 0 });
  });

  it('keeps tabs, newlines, emoji and non-Latin text; trims the edges', async () => {
    const host = await makeHost(PRICE);
    const guest = await makeGuest();
    const id = await completedStay(host, guest);
    const comment = 'बहुत अच्छा 🙏\nसाफ़-सुथरा\tकमरा';
    const res = await call(createReview, { token: guest.token, params: { id }, body: { overall: 5, title: '  शानदार 😀  ', comment: `  ${comment}  ` } });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ title: 'शानदार 😀', comment });
  });
});

describe('editing and deleting', () => {
  async function reviewed(overall = 3) {
    const host = await makeHost(PRICE);
    const guest = await makeGuest();
    const id = await completedStay(host, guest);
    const res = await call(createReview, { token: guest.token, params: { id }, body: { overall, cleanliness: 3, title: 'Okay', comment: 'It was okay.' } });
    return { host, guest, bookingId: id, reviewId: res.body.data.id as string };
  }

  it('the author can change ratings and clear optional fields; the hostel rating follows', async () => {
    const { host, guest, reviewId } = await reviewed(3);
    expect(await hostelRow(host.hostel.id)).toEqual({ avgRating: 3, reviewCount: 1 });
    const res = await call(patchReview, { method: 'PATCH', token: guest.token, params: { id: reviewId }, body: { overall: 5, cleanliness: null, title: null, comment: 'Much better on reflection.' } });
    expect(res.status).toBe(200);
    expect(issues(myReviewSchema, res.body.data)).toEqual([]);
    expect(res.body.data).toMatchObject({ overall: 5, cleanliness: null, title: null, comment: 'Much better on reflection.' });
    expect(res.body.data.editedAt).toBeTruthy();
    expect(await hostelRow(host.hostel.id)).toEqual({ avgRating: 5, reviewCount: 1 });
    const audit = await prisma.auditLog.findMany({ where: { entityId: reviewId, action: 'review.update' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ before: { overall: 3, cleanliness: 3 }, after: { overall: 5, cleanliness: null } });
  });

  it('rejects empty and malformed patches, and other people', async () => {
    const { guest, reviewId } = await reviewed();
    const stranger = await makeGuest();
    expect((await call(patchReview, { method: 'PATCH', token: guest.token, params: { id: reviewId }, body: {} })).status).toBe(422);
    expect((await call(patchReview, { method: 'PATCH', token: guest.token, params: { id: reviewId }, body: { overall: null } })).status).toBe(422); // overall can't be cleared
    expect((await call(patchReview, { method: 'PATCH', token: guest.token, params: { id: reviewId }, body: { status: 'HIDDEN' } })).status).toBe(422);
    expect((await call(patchReview, { method: 'PATCH', token: stranger.token, params: { id: reviewId }, body: { overall: 1 } })).status).toBe(404);
    expect((await call(deleteReview, { method: 'DELETE', token: stranger.token, params: { id: reviewId } })).status).toBe(404);
    expect((await call(patchReview, { method: 'PATCH', params: { id: reviewId }, body: { overall: 1 } })).status).toBe(401);
  });

  it(`closes ${REVIEW_EDIT_WINDOW_DAYS} days after posting`, async () => {
    const { guest, reviewId } = await reviewed();
    const day = 86_400_000;
    const guestActor = actorOf(guest, 'GUEST');
    await expect(reviewsService.update(guestActor, reviewId, { overall: 4 }, new Date(Date.now() + (REVIEW_EDIT_WINDOW_DAYS + 1) * day))).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(reviewsService.remove(guestActor, reviewId, new Date(Date.now() + (REVIEW_EDIT_WINDOW_DAYS + 1) * day))).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(reviewsService.update(guestActor, reviewId, { overall: 4 }, new Date(Date.now() + (REVIEW_EDIT_WINDOW_DAYS - 1) * day))).resolves.toMatchObject({ overall: 4 });
    const mine = await call(myReviews, { method: 'GET', token: guest.token });
    expect(mine.body.data[0]).toMatchObject({ id: reviewId, editable: true });
    expect(new Date(mine.body.data[0].editableUntil).getTime()).toBeGreaterThan(Date.now() + (REVIEW_EDIT_WINDOW_DAYS - 1) * day);
  });

  it('is locked once the host has replied (no swapping the rating under an answer)', async () => {
    const { host, guest, reviewId } = await reviewed(1);
    expect((await call(putReply, { method: 'PUT', token: host.owner.token, params: { id: reviewId }, body: { text: 'We are sorry to hear that.' } })).status).toBe(200);
    const edit = await call(patchReview, { method: 'PATCH', token: guest.token, params: { id: reviewId }, body: { overall: 5 } });
    expect(edit.status).toBe(409);
    expect(edit.body.error.message).toMatch(/replied/i);
    expect((await call(deleteReview, { method: 'DELETE', token: guest.token, params: { id: reviewId } })).status).toBe(409);
    expect(await hostelRow(host.hostel.id)).toEqual({ avgRating: 1, reviewCount: 1 });
    const mine = await call(myReviews, { method: 'GET', token: guest.token });
    expect(mine.body.data[0]).toMatchObject({ editable: false, editableUntil: null, ownerReply: 'We are sorry to hear that.' });
  });

  it('deleting removes it from the rating, frees the booking for a new review, and is audited', async () => {
    const { host, guest, bookingId, reviewId } = await reviewed(2);
    const del = await call(deleteReview, { method: 'DELETE', token: guest.token, params: { id: reviewId } });
    expect(del.status).toBe(200);
    expect(del.body.data).toEqual({ deleted: true });
    expect(await hostelRow(host.hostel.id)).toEqual({ avgRating: 0, reviewCount: 0 });
    expect((await call(deleteReview, { method: 'DELETE', token: guest.token, params: { id: reviewId } })).status).toBe(404);
    expect((await read(guest.token, bookingId)).body.data).toMatchObject({ reviewId: null, actions: expect.arrayContaining(['review']) });
    expect((await call(createReview, { token: guest.token, params: { id: bookingId }, body: { overall: 4 } })).status).toBe(201);
    expect(await hostelRow(host.hostel.id)).toEqual({ avgRating: 4, reviewCount: 1 });
    expect(await prisma.auditLog.count({ where: { entityId: reviewId, action: 'review.delete' } })).toBe(1);
  });
});

describe('host replies and reports', () => {
  it('a host replies to a review of their own property; the guest hears about the first reply only', async () => {
    const host = await makeHost(PRICE);
    const { review } = await seedReview(host.hostel.id, 4);
    const mine = await seedReview(host.hostel.id, 5);
    const id = mine.review.id;

    const res = await call(putReply, { method: 'PUT', token: host.owner.token, params: { id }, body: { text: '  Thank you for staying with us!  ' } });
    expect(res.status).toBe(200);
    expect(issues(ownerReviewSchema, res.body.data)).toEqual([]);
    expect(res.body.data).toMatchObject({ ownerReply: 'Thank you for staying with us!', status: 'PUBLISHED' });
    expect(res.body.data.ownerRepliedAt).toBeTruthy();

    const edited = await call(putReply, { method: 'PUT', token: host.owner.token, params: { id }, body: { text: 'Updated reply.' } });
    expect(edited.body.data.ownerReply).toBe('Updated reply.');
    expect((await notificationsFor(mine.guest.id)).filter((n) => n.type === 'REVIEW_REPLIED')).toHaveLength(1);

    const pub = await call(publicReviews, { method: 'GET', params: { idOrSlug: host.hostel.id } });
    expect(pub.body.data.find((r: { id: string }) => r.id === id)).toMatchObject({ ownerReply: 'Updated reply.' });
    expect(pub.body.data.find((r: { id: string }) => r.id === review.id).ownerReply).toBeNull();

    const gone = await call(removeReply, { method: 'DELETE', token: host.owner.token, params: { id } });
    expect(gone.body.data).toMatchObject({ ownerReply: null, ownerRepliedAt: null });
    expect((await call(removeReply, { method: 'DELETE', token: host.owner.token, params: { id } })).status).toBe(409); // nothing to remove
    expect((await prisma.auditLog.findMany({ where: { entityId: id, action: { startsWith: 'review.reply' } }, orderBy: { id: 'asc' } })).map((a) => a.action)).toEqual(['review.reply.create', 'review.reply.update', 'review.reply.delete']);
  });

  it('only the owner of that property may reply; guests and other hosts get 403/404', async () => {
    const host = await makeHost(PRICE);
    const rival = await makeHost(PRICE);
    const guest = await makeGuest();
    const { review } = await seedReview(host.hostel.id, 3);
    const body = { text: 'Hello' };
    expect((await call(putReply, { method: 'PUT', token: rival.owner.token, params: { id: review.id }, body })).status).toBe(404);
    expect((await call(putReply, { method: 'PUT', token: guest.token, params: { id: review.id }, body })).status).toBe(403);
    expect((await call(putReply, { method: 'PUT', params: { id: review.id }, body })).status).toBe(401);
    expect((await call(putReply, { method: 'PUT', token: host.owner.token, params: { id: review.id }, body: { text: '' } })).status).toBe(422);
    expect((await call(putReply, { method: 'PUT', token: host.owner.token, params: { id: review.id }, body: { text: 'x'.repeat(1001) } })).status).toBe(422);
    expect((await call(removeReply, { method: 'DELETE', token: rival.owner.token, params: { id: review.id } })).status).toBe(404);
    expect((await prisma.review.findUniqueOrThrow({ where: { id: review.id } })).ownerReply).toBeNull();
  });

  it('lists my properties\' reviews with filters, never anyone else\'s', async () => {
    const host = await makeHost(PRICE);
    const rival = await makeHost(PRICE);
    const a = await seedReview(host.hostel.id, 5);
    const b = await seedReview(host.hostel.id, 2);
    await seedReview(rival.hostel.id, 1);
    await call(putReply, { method: 'PUT', token: host.owner.token, params: { id: a.review.id }, body: { text: 'Thanks!' } });

    const all = await call(ownerReviews, { method: 'GET', token: host.owner.token });
    expect(all.body.data.map((r: { id: string }) => r.id).sort()).toEqual([a.review.id, b.review.id].sort());
    expect(issues(ownerReviewSchema, all.body.data[0])).toEqual([]);
    const ids = async (q: string) => (await call(ownerReviews, { method: 'GET', token: host.owner.token, query: q })).body.data.map((r: { id: string }) => r.id);
    expect(await ids('?replied=false')).toEqual([b.review.id]);
    expect(await ids('?replied=true')).toEqual([a.review.id]);
    expect(await ids('?rating=2')).toEqual([b.review.id]);
    expect(await ids(`?hostelId=${rival.hostel.id}`)).toEqual([]); // someone else's property: empty, not an error and not their data
    expect((await call(ownerReviews, { method: 'GET', token: (await makeGuest()).token })).status).toBe(403);
  });

  it('reporting asks moderators to look: once per review, admins notified, hosts cannot hide', async () => {
    const admin = await makeAdmin();
    const host = await makeHost(PRICE);
    const rival = await makeHost(PRICE);
    const { review } = await seedReview(host.hostel.id, 1, { comment: 'Spam spam spam' });

    expect((await call(reportReview, { token: rival.owner.token, params: { id: review.id }, body: { reason: 'Not mine' } })).status).toBe(404);
    expect((await call(reportReview, { token: host.owner.token, params: { id: review.id }, body: { reason: '' } })).status).toBe(422);
    const ok = await call(reportReview, { token: host.owner.token, params: { id: review.id }, body: { reason: 'This guest never stayed with us.' } });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ reported: true });
    const note = (await notificationsFor(admin.id)).find((n) => n.title === 'Review reported by a host');
    expect(note).toBeTruthy();
    expect(note!.data).toMatchObject({ reviewId: review.id, hostelId: host.hostel.id });

    const again = await call(reportReview, { token: host.owner.token, params: { id: review.id }, body: { reason: 'Again' } });
    expect(again.status).toBe(409);
    expect(await prisma.auditLog.count({ where: { entityId: review.id, action: 'review.report' } })).toBe(1); // the duplicate rolled back
    expect((await prisma.review.findUniqueOrThrow({ where: { id: review.id } })).status).toBe('PUBLISHED'); // reporting hides nothing
  });
});

describe('moderation', () => {
  it('hiding removes a review from the public rating immediately, tells the guest why, and can be undone', async () => {
    const admin = await makeAdmin();
    const host = await makeHost(PRICE);
    const bad = await seedReview(host.hostel.id, 1, { comment: 'Offensive text' });
    await seedReview(host.hostel.id, 5);
    await seedReview(host.hostel.id, 5);
    await reviewsService.summary(host.hostel.id); // warm the cache
    await call(publicHostel, { method: 'GET', params: { idOrSlug: host.hostel.id } });
    await reconcileRatings(prisma); // the seeded rows bypass the service, so bring the stored rating in line first
    expect(await hostelRow(host.hostel.id)).toEqual({ avgRating: 3.67, reviewCount: 3 });

    expect((await call(hideReview, { token: (await makeGuest()).token, params: { id: bad.review.id }, body: { reason: 'x' } })).status).toBe(403);
    expect((await call(hideReview, { token: host.owner.token, params: { id: bad.review.id }, body: { reason: 'I dislike it' } })).status).toBe(403); // hosts cannot hide
    expect((await call(hideReview, { token: admin.token, params: { id: bad.review.id }, body: { reason: '' } })).status).toBe(422);

    const res = await call(hideReview, { token: admin.token, params: { id: bad.review.id }, body: { reason: 'Contains abuse' } });
    expect(res.status).toBe(200);
    expect(issues(adminReviewSchema, res.body.data)).toEqual([]);
    expect(res.body.data).toMatchObject({ status: 'HIDDEN', moderationReason: 'Contains abuse', moderatedById: admin.id, guestId: bad.guest.id, guestEmail: bad.guest.email });
    expect(await hostelRow(host.hostel.id)).toEqual({ avgRating: 5, reviewCount: 2 });
    expect((await call(publicHostel, { method: 'GET', params: { idOrSlug: host.hostel.id } })).body.data).toMatchObject({ avgRating: 5, reviewCount: 2 });
    const pub = await call(publicReviews, { method: 'GET', params: { idOrSlug: host.hostel.id } });
    expect(pub.body.data).toHaveLength(2);
    expect(JSON.stringify(pub.body)).not.toContain('Offensive text');
    expect((await call(reviewSummary, { method: 'GET', params: { idOrSlug: host.hostel.id } })).body.data.distribution).toMatchObject({ '1': 0, '5': 2 });

    const note = (await notificationsFor(bad.guest.id)).find((n) => n.title === 'Your review was removed');
    expect(note!.body).toContain('Contains abuse');
    expect((await call(hideReview, { token: admin.token, params: { id: bad.review.id }, body: { reason: 'again' } })).status).toBe(409);

    // the guest sees the verdict and cannot edit or delete around it
    const mine = await call(myReviews, { method: 'GET', token: bad.guest.token });
    expect(mine.body.data[0]).toMatchObject({ status: 'HIDDEN', moderationReason: 'Contains abuse', editable: false });
    expect((await call(patchReview, { method: 'PATCH', token: bad.guest.token, params: { id: bad.review.id }, body: { overall: 5 } })).status).toBe(409);
    expect((await call(deleteReview, { method: 'DELETE', token: bad.guest.token, params: { id: bad.review.id } })).status).toBe(409);
    expect((await call(putReply, { method: 'PUT', token: host.owner.token, params: { id: bad.review.id }, body: { text: 'Reply to hidden' } })).status).toBe(409);

    const back = await call(restoreReview, { token: admin.token, params: { id: bad.review.id } });
    expect(back.body.data).toMatchObject({ status: 'PUBLISHED', moderationReason: null });
    expect(await hostelRow(host.hostel.id)).toEqual({ avgRating: 3.67, reviewCount: 3 });
    expect((await call(restoreReview, { token: admin.token, params: { id: bad.review.id } })).status).toBe(409);
    expect((await prisma.auditLog.findMany({ where: { entityId: bad.review.id, action: { in: ['review.hide', 'review.restore'] } }, orderBy: { id: 'asc' } })).map((a) => a.action)).toEqual(['review.hide', 'review.restore']);
    expect((await call(hideReview, { token: admin.token, params: { id: '00000000-0000-4000-8000-000000000000' }, body: { reason: 'x' } })).status).toBe(404);
  });

  it('the admin list filters by status, property and rating', async () => {
    const admin = await makeAdmin();
    const host = await makeHost(PRICE);
    const a = await seedReview(host.hostel.id, 5);
    const b = await seedReview(host.hostel.id, 1, { status: 'HIDDEN' });
    const ids = async (q: string) => (await call(adminReviews, { method: 'GET', token: admin.token, query: q })).body.data.map((r: { id: string }) => r.id);
    expect(await ids(`?hostelId=${host.hostel.id}`)).toHaveLength(2);
    expect(await ids(`?hostelId=${host.hostel.id}&status=HIDDEN`)).toEqual([b.review.id]);
    expect(await ids(`?hostelId=${host.hostel.id}&rating=5`)).toEqual([a.review.id]);
    expect((await call(adminReviews, { method: 'GET', token: host.owner.token })).status).toBe(403);
  });
});

describe('public listing', () => {
  it('sorts, filters and pages without gaps or repeats (including identical timestamps), and caches', async () => {
    const host = await makeHost(PRICE);
    const t = (m: number) => new Date(Date.now() - m * 60_000);
    const tie = t(10);
    const made = [
      await seedReview(host.hostel.id, 5, { createdAt: t(1), name: 'Priya Sharma' }), await seedReview(host.hostel.id, 4, { createdAt: tie }), await seedReview(host.hostel.id, 4, { createdAt: tie }),
      await seedReview(host.hostel.id, 3, { createdAt: t(20) }), await seedReview(host.hostel.id, 2, { createdAt: t(30) }), await seedReview(host.hostel.id, 1, { createdAt: t(40) }), await seedReview(host.hostel.id, 5, { createdAt: t(50) }),
    ];
    await seedReview(host.hostel.id, 1, { status: 'HIDDEN' });
    const all = made.map((m) => m.review);
    const page = async (q: string, cursor?: string) => call(publicReviews, { method: 'GET', params: { idOrSlug: host.hostel.slug }, query: `?${q}${cursor ? `&cursor=${cursor}` : ''}` });
    const walk = async (q: string) => {
      const out: { id: string; overall: number }[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const res = await page(q, cursor);
        expect(res.status).toBe(200);
        out.push(...res.body.data);
        cursor = res.body.meta.nextCursor ?? undefined;
        if (!cursor) break;
      }
      return out;
    };

    const first = await page('limit=50');
    expect(first.status).toBe(200);
    expect(first.headers.get('x-cache')).toBe('MISS');
    expect((await page('limit=50')).headers.get('x-cache')).toBe('HIT');
    expect(first.body.data).toHaveLength(7); // the hidden one is excluded
    expect(first.body.data.every((r: unknown) => issues(publicReviewSchema, r).length === 0)).toBe(true);
    expect(first.body.data[0]).toMatchObject({ reviewer: { name: 'Priya S.' } });
    expect(JSON.stringify(first.body)).not.toMatch(/@test\.dev|guestId|guestEmail/);

    const recent = await walk('limit=3&sort=recent');
    expect(recent.map((r) => r.id)).toEqual([...all].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime() || (x.id < y.id ? 1 : -1)).map((r) => r.id));
    const highest = await walk('limit=2&sort=highest');
    expect(highest.map((r) => r.overall)).toEqual([5, 5, 4, 4, 3, 2, 1]);
    expect(new Set(highest.map((r) => r.id)).size).toBe(7);
    const lowest = await walk('limit=4&sort=lowest');
    expect(lowest.map((r) => r.overall)).toEqual([1, 2, 3, 4, 4, 5, 5]);
    expect((await walk('limit=1&rating=4')).map((r) => r.overall)).toEqual([4, 4]);
    expect(await walk('rating=3')).toHaveLength(1);

    for (const bad of ['sort=newest', 'rating=0', 'rating=6', 'rating=x', 'limit=0', 'limit=51']) expect((await page(bad)).status).toBe(422);
    expect((await call(publicReviews, { method: 'GET', params: { idOrSlug: 'no-such-hostel' } })).status).toBe(404);
  });

  it('is only available for live listings', async () => {
    const draft = await makeHost({ ...PRICE, status: 'DRAFT' });
    const gone = await makeHost({ ...PRICE, deleted: true });
    for (const h of [draft, gone]) {
      expect((await call(publicReviews, { method: 'GET', params: { idOrSlug: h.hostel.id } })).status).toBe(404);
      expect((await call(reviewSummary, { method: 'GET', params: { idOrSlug: h.hostel.id } })).status).toBe(404);
    }
  });

  it('summarises the rating distribution and category averages, and refreshes after a change', async () => {
    const host = await makeHost(PRICE);
    expect((await call(reviewSummary, { method: 'GET', params: { idOrSlug: host.hostel.id } })).body.data).toMatchObject({ avgRating: 0, reviewCount: 0, categories: { cleanliness: null } });
    const plan = [{ overall: 5, cleanliness: 5 }, { overall: 4, cleanliness: 3, staff: 4 }, { overall: 4, cleanliness: 3, staff: 4 }];
    for (const body of plan) {
      const g = await makeGuest();
      const b = await completedRow(host.hostel.id, g.id);
      expect((await call(createReview, { token: g.token, params: { id: b.id }, body })).status).toBe(201);
    }
    const res = await call(reviewSummary, { method: 'GET', params: { idOrSlug: host.hostel.id } });
    expect(issues(reviewSummarySchema, res.body.data)).toEqual([]);
    expect(res.body.data).toEqual({
      avgRating: 4.33, reviewCount: 3, distribution: { '1': 0, '2': 0, '3': 0, '4': 2, '5': 1 },
      categories: { cleanliness: 3.67, location: null, staff: 4, valueForMoney: null },
    });
    expect(res.headers.get('x-cache')).toBe('MISS');
  });
});

describe('integrity under concurrency', () => {
  it('twelve guests reviewing at once all land and the stored rating is exact', async () => {
    const host = await makeHost(PRICE);
    const ratings = [5, 4, 3, 5, 4, 3, 2, 1, 5, 4, 3, 5];
    const jobs = await Promise.all(ratings.map(async (overall) => {
      const g = await makeUser({ roles: ['GUEST'] });
      return { g, overall, b: await completedRow(host.hostel.id, g.id) };
    }));
    const results = await Promise.all(jobs.map((j) => reviewsService.create(actorOf(j.g, 'GUEST'), j.b.id, { overall: j.overall })));
    expect(results).toHaveLength(12);
    expect(await hostelRow(host.hostel.id)).toEqual({ avgRating: 3.67, reviewCount: 12 }); // 44 / 12
    expect(await reconcileRatings(prisma)).not.toContain(host.hostel.id); // nothing to repair
  });

  it('mixed creates, edits, deletes and moderation in parallel never lose an update', async () => {
    const admin = await makeAdmin();
    const host = await makeHost(PRICE);
    const mk = async (overall: number) => {
      const g = await makeUser({ roles: ['GUEST'] });
      const b = await completedRow(host.hostel.id, g.id);
      const r = await reviewsService.create(actorOf(g, 'GUEST'), b.id, { overall });
      return { g, id: r.id };
    };
    const existing = await Promise.all([5, 4, 3, 2, 1, 5, 4, 3, 2, 5].map(mk));
    const fresh = await Promise.all([3, 4, 5].map(async (overall) => {
      const g = await makeUser({ roles: ['GUEST'] });
      return { g, overall, b: await completedRow(host.hostel.id, g.id) };
    }));

    const ops = [
      ...existing.slice(0, 3).map((e) => reviewsService.update(actorOf(e.g, 'GUEST'), e.id, { overall: 1 })),
      ...existing.slice(3, 5).map((e) => reviewsModerationService.hide(actorOf(admin, 'ADMIN'), e.id, 'spam')),
      ...existing.slice(5, 7).map((e) => reviewsService.remove(actorOf(e.g, 'GUEST'), e.id)),
      ...fresh.map((f) => reviewsService.create(actorOf(f.g, 'GUEST'), f.b.id, { overall: f.overall })),
    ];
    expect((await Promise.allSettled(ops)).every((o) => o.status === 'fulfilled')).toBe(true);
    expect(await hostelRow(host.hostel.id)).toEqual(await expectedFromRows(host.hostel.id));
    expect((await hostelRow(host.hostel.id)).reviewCount).toBe(10 - 2 - 2 + 3);
  });

  it('the nightly reconcile job repairs a drifted rating and nothing else', async () => {
    const host = await makeHost(PRICE);
    const other = await makeHost(PRICE);
    await seedReview(host.hostel.id, 4);
    await seedReview(host.hostel.id, 2);
    await prisma.hostel.update({ where: { id: host.hostel.id }, data: { avgRating: 4.9, reviewCount: 99 } });
    const untouched = await prisma.hostel.findUniqueOrThrow({ where: { id: other.hostel.id }, select: { updatedAt: true } });

    const fixed = await reconcileRatings(prisma);
    expect(fixed).toContain(host.hostel.id);
    expect(fixed).not.toContain(other.hostel.id);
    expect(await hostelRow(host.hostel.id)).toEqual({ avgRating: 3, reviewCount: 2 });
    expect((await prisma.hostel.findUniqueOrThrow({ where: { id: other.hostel.id }, select: { updatedAt: true } })).updatedAt).toEqual(untouched.updatedAt);
    expect(await reconcileRatings(prisma)).not.toContain(host.hostel.id); // idempotent
    await expect(handlers['reconcile-ratings']({})).resolves.toBeUndefined();
  });
});

describe('database guards', () => {
  const insert = (data: { bookingId: string; hostelId: string; guestId: string }) => prisma.review.create({ data: { ...data, overall: 5 } });

  it('refuses a review for a booking that is not completed', async () => {
    const host = await makeHost(PRICE);
    const guest = await makeGuest();
    const bookingId = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id);
    await expect(insert({ bookingId, hostelId: host.hostel.id, guestId: guest.id })).rejects.toThrow(/only a completed stay can be reviewed/);
  });

  it('refuses a review whose guest or hostel does not match the booking', async () => {
    const host = await makeHost(PRICE);
    const rival = await makeHost(PRICE);
    const guest = await makeGuest();
    const stranger = await makeGuest();
    const b = await completedRow(host.hostel.id, guest.id);
    await expect(insert({ bookingId: b.id, hostelId: host.hostel.id, guestId: stranger.id })).rejects.toThrow(/must match the booking/);
    await expect(insert({ bookingId: b.id, hostelId: rival.hostel.id, guestId: guest.id })).rejects.toThrow(/must match the booking/);
    await expect(insert({ bookingId: '00000000-0000-4000-8000-000000000000', hostelId: host.hostel.id, guestId: guest.id })).rejects.toThrow();
    await expect(prisma.review.create({ data: { bookingId: b.id, hostelId: host.hostel.id, guestId: guest.id, overall: 6 } })).rejects.toThrow(/reviews_overall_range/);
    await expect(insert({ bookingId: b.id, hostelId: host.hostel.id, guestId: guest.id })).resolves.toBeTruthy();
    await expect(insert({ bookingId: b.id, hostelId: host.hostel.id, guestId: guest.id })).rejects.toThrow(); // one review per booking
  });
});
