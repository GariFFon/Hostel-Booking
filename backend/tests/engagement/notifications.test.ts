import { beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@/core/dates';
import { NotificationType } from '@/generated/prisma/client';
import { prisma } from '@/infra/db/prisma';
import { outbox } from '@/infra/mail/mailer';
import { redis } from '@/infra/redis/redis';
import { GET as listFeed } from '@/app/api/v1/me/notifications/route';
import { GET as unreadCount } from '@/app/api/v1/me/notifications/unread-count/route';
import { POST as readAll } from '@/app/api/v1/me/notifications/read-all/route';
import { POST as readOne } from '@/app/api/v1/me/notifications/[id]/read/route';
import { DELETE as deleteOne } from '@/app/api/v1/me/notifications/[id]/route';
import { GET as getPrefs, PATCH as patchPrefs } from '@/app/api/v1/me/notification-preferences/route';
import { POST as registerDevice } from '@/app/api/v1/me/devices/route';
import { DELETE as removeDevice } from '@/app/api/v1/me/devices/[id]/route';
import { handlers } from '@/jobs/handlers';
import { bookingLifecycle } from '@/modules/bookings/booking-lifecycle.service';
import { NOTIFICATION_CATEGORY, DEFAULT_PREFERENCES, inAppAllowed } from '@/modules/notifications/notification-policy';
import { notify, pruneNotifications } from '@/modules/notifications/notifications.service';
import { deviceDtoSchema, notificationDtoSchema, notificationPreferencesSchema, readAllResultSchema, unreadCountSchema } from '@/modules/notifications/notifications.schema';
import { reviewsService } from '@/modules/reviews/reviews.service';
import { SCHEDULES } from '@/worker';
import { call } from '../helpers/http';
import { STAY, confirmedBooking, makeGuest, makeHost, notificationsFor } from '../helpers/booking';
import { actorOf, at, completedRow, issues } from '../helpers/engagement';
import { makeUser } from '../helpers/users';

beforeAll(async () => {
  await redis.flushdb();
});

const PRICE = { rooms: [{ units: 6, price: 80000 }] };
const DAY = 86_400_000;
const feed = (token: string, query = '') => call(listFeed, { method: 'GET', token, query });
const unread = async (token: string) => (await call(unreadCount, { method: 'GET', token })).body.data.unread as number;
const seed = (userId: string, over: Partial<{ type: NotificationType; title: string; readAt: Date | null; createdAt: Date; data: object }> = {}) =>
  prisma.notification.create({ data: { userId, type: over.type ?? 'SYSTEM', title: over.title ?? 'Hello', body: 'Body text', readAt: over.readAt ?? null, ...(over.createdAt ? { createdAt: over.createdAt } : {}), ...(over.data ? { data: over.data } : {}) } });
const setPrefs = (token: string, body: object) => call(patchPrefs, { method: 'PATCH', token, body });
const allOff = { emailBookings: false, emailMarketing: false, inAppBookings: false, inAppReviews: false };

describe('the notification feed', () => {
  it('lists the newest first in the response contract, with deep-link data, and nobody else\'s', async () => {
    const a = await makeGuest();
    const b = await makeGuest();
    const now = Date.now();
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await seed(a.id, { title: `n${i}`, createdAt: new Date(now - i * 60_000), data: i === 0 ? { bookingId: 'abc', code: 'HB123' } : undefined }));
    await seed(b.id, { title: 'private to b' });

    const res = await feed(a.token);
    expect(res.status).toBe(200);
    expect(res.body.data.map((n: { title: string }) => n.title)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4']);
    expect(res.body.data.every((n: unknown) => issues(notificationDtoSchema, n).length === 0)).toBe(true);
    expect(res.body.data[0]).toMatchObject({ id: made[0]!.id, type: 'SYSTEM', read: false, readAt: null, data: { bookingId: 'abc', code: 'HB123' } });
    expect(res.body.data[1].data).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('private to b');
    expect((await feed(b.token)).body.data.map((n: { title: string }) => n.title)).toEqual(['private to b']);
    expect((await call(listFeed, { method: 'GET' })).status).toBe(401);
  });

  it('pages without gaps or repeats, including notifications created in the same instant', async () => {
    const user = await makeGuest();
    const same = new Date(Date.now() - 60_000);
    for (let i = 0; i < 4; i++) await seed(user.id, { title: `tie${i}`, createdAt: same });
    for (let i = 0; i < 3; i++) await seed(user.id, { title: `old${i}`, createdAt: new Date(same.getTime() - (i + 1) * 1000) });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 8; page++) {
      const res = await feed(user.token, `?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...res.body.data.map((n: { id: string }) => n.id));
      cursor = res.body.meta.nextCursor ?? undefined;
      if (!cursor) { expect(page).toBe(2); break; }
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    const all = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    expect(seen).toEqual(all.map((n) => n.id));
  });

  it('filters by unread and by type, and rejects bad queries', async () => {
    const user = await makeGuest();
    await seed(user.id, { title: 'unread sys' });
    await seed(user.id, { title: 'read sys', readAt: new Date() });
    await seed(user.id, { title: 'unread kyc', type: 'KYC_APPROVED' });
    const titles = async (q: string) => (await feed(user.token, q)).body.data.map((n: { title: string }) => n.title).sort();
    expect(await titles('?unread=true')).toEqual(['unread kyc', 'unread sys']);
    expect(await titles('?unread=false')).toHaveLength(3); // only "true" narrows; anything valid-but-false is the full list
    expect(await titles('?type=KYC_APPROVED')).toEqual(['unread kyc']);
    expect(await titles('?type=SYSTEM&unread=true')).toEqual(['unread sys']);
    for (const bad of ['?type=NOPE', '?unread=maybe', '?limit=0', '?limit=51', '?limit=abc']) expect((await feed(user.token, bad)).status).toBe(422);
  });

  it('counts unread for the badge, cheaply and per user', async () => {
    const user = await makeGuest();
    const other = await makeGuest();
    expect(issues(unreadCountSchema, (await call(unreadCount, { method: 'GET', token: user.token })).body.data)).toEqual([]);
    expect(await unread(user.token)).toBe(0);
    await seed(user.id); await seed(user.id); await seed(user.id, { readAt: new Date() }); await seed(other.id);
    expect(await unread(user.token)).toBe(2);
    expect(await unread(other.token)).toBe(1);
    expect((await call(unreadCount, { method: 'GET' })).status).toBe(401);
  });
});

describe('reading and deleting', () => {
  it('marks one read, keeping the first read time on repeats', async () => {
    const user = await makeGuest();
    const n = await seed(user.id);
    const first = await call(readOne, { token: user.token, params: { id: n.id } });
    expect(first.status).toBe(200);
    expect(issues(notificationDtoSchema, first.body.data)).toEqual([]);
    expect(first.body.data).toMatchObject({ id: n.id, read: true });
    await new Promise((r) => setTimeout(r, 15));
    const again = await call(readOne, { token: user.token, params: { id: n.id } });
    expect(again.body.data.readAt).toBe(first.body.data.readAt);
    expect(await unread(user.token)).toBe(0);
  });

  it('other people\'s notifications behave as if they do not exist', async () => {
    const owner = await makeGuest();
    const intruder = await makeGuest();
    const n = await seed(owner.id);
    expect((await call(readOne, { token: intruder.token, params: { id: n.id } })).status).toBe(404);
    expect((await call(deleteOne, { method: 'DELETE', token: intruder.token, params: { id: n.id } })).status).toBe(404);
    expect((await call(readOne, { token: owner.token, params: { id: 'not-a-uuid' } })).status).toBe(404);
    expect((await call(readOne, { token: owner.token, params: { id: '00000000-0000-4000-8000-000000000000' } })).status).toBe(404);
    expect((await call(readOne, { params: { id: n.id } })).status).toBe(401);
    expect(await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).toMatchObject({ readAt: null });
  });

  it('marks everything read for the caller only', async () => {
    const user = await makeGuest();
    const other = await makeGuest();
    for (let i = 0; i < 4; i++) await seed(user.id);
    await seed(user.id, { readAt: new Date(Date.now() - 5 * DAY) });
    await seed(other.id);
    const res = await call(readAll, { token: user.token });
    expect(issues(readAllResultSchema, res.body.data)).toEqual([]);
    expect(res.body.data).toEqual({ updated: 4 }); // the one already read does not count
    expect(await unread(user.token)).toBe(0);
    expect(await unread(other.token)).toBe(1);
    expect((await call(readAll, { token: user.token })).body.data).toEqual({ updated: 0 });
  });

  it('deletes one', async () => {
    const user = await makeGuest();
    const n = await seed(user.id);
    const res = await call(deleteOne, { method: 'DELETE', token: user.token, params: { id: n.id } });
    expect(res.body.data).toEqual({ deleted: true });
    expect((await feed(user.token)).body.data).toEqual([]);
    expect((await call(deleteOne, { method: 'DELETE', token: user.token, params: { id: n.id } })).status).toBe(404);
  });
});

describe('preferences', () => {
  it('start at the defaults, change partially, persist, and are audited', async () => {
    const user = await makeGuest();
    const initial = await call(getPrefs, { method: 'GET', token: user.token });
    expect(issues(notificationPreferencesSchema, initial.body.data)).toEqual([]);
    expect(initial.body.data).toEqual(DEFAULT_PREFERENCES);
    expect(await prisma.notificationPreference.count({ where: { userId: user.id } })).toBe(0); // reading creates nothing

    const first = await setPrefs(user.token, { emailMarketing: true });
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ ...DEFAULT_PREFERENCES, emailMarketing: true });
    expect((await setPrefs(user.token, { inAppReviews: false })).body.data).toEqual({ emailBookings: true, emailMarketing: true, inAppBookings: true, inAppReviews: false }); // merged, not replaced
    expect((await call(getPrefs, { method: 'GET', token: user.token })).body.data).toEqual({ emailBookings: true, emailMarketing: true, inAppBookings: true, inAppReviews: false });
    const audit = await prisma.auditLog.findMany({ where: { entityId: user.id, action: 'notification.preferences.update' }, orderBy: { id: 'asc' } });
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ before: DEFAULT_PREFERENCES, after: { emailMarketing: true } });
  });

  it.each([['empty', {}], ['unknown field', { smsMarketing: true }], ['not a boolean', { emailBookings: 'yes' }], ['null', { inAppBookings: null }], ['the user id', { userId: '00000000-0000-4000-8000-000000000000' }]])('rejects a %s patch (422)', async (_n, body) => {
    const user = await makeGuest();
    expect((await setPrefs(user.token, body)).status).toBe(422);
    expect(await prisma.notificationPreference.count({ where: { userId: user.id } })).toBe(0);
  });

  it('need a login, and one user cannot change another\'s', async () => {
    const a = await makeGuest();
    const b = await makeGuest();
    expect((await call(getPrefs, { method: 'GET' })).status).toBe(401);
    expect((await call(patchPrefs, { method: 'PATCH', body: { emailBookings: false } })).status).toBe(401);
    await setPrefs(a.token, allOff);
    expect((await call(getPrefs, { method: 'GET', token: b.token })).body.data).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('what preferences actually control', () => {
  it('every notification type is classified, and only account/moderation/system notices cannot be muted', () => {
    const types = Object.values(NotificationType);
    expect(types.length).toBeGreaterThan(15);
    for (const t of types) {
      expect(['bookings', 'reviews', 'always']).toContain(NOTIFICATION_CATEGORY[t]);
      expect(inAppAllowed(t, allOff)).toBe(NOTIFICATION_CATEGORY[t] === 'always');
      expect(inAppAllowed(t, { ...allOff, inAppBookings: true })).toBe(NOTIFICATION_CATEGORY[t] !== 'reviews');
      expect(inAppAllowed(t, { ...allOff, inAppReviews: true })).toBe(NOTIFICATION_CATEGORY[t] !== 'bookings');
      expect(inAppAllowed(t, DEFAULT_PREFERENCES)).toBe(true);
    }
    expect(Object.keys(NOTIFICATION_CATEGORY).sort()).toEqual([...types].sort());
    for (const t of ['KYC_APPROVED', 'KYC_REJECTED', 'HOSTEL_APPROVED', 'HOSTEL_REJECTED', 'SYSTEM'] as const) expect(NOTIFICATION_CATEGORY[t]).toBe('always');
  });

  it('muting booking notifications silences the feed, not the emails, and leaves the other party untouched', async () => {
    const host = await makeHost(PRICE);
    const guest = await makeGuest();
    await setPrefs(guest.token, { inAppBookings: false });
    const id = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id);

    expect((await notificationsFor(guest.id)).filter((n) => n.type.startsWith('BOOKING') || n.type.startsWith('PAYMENT'))).toEqual([]); // nothing in the guest's feed
    expect((await notificationsFor(host.owner.id)).map((n) => n.type)).toContain('BOOKING_CREATED'); // the host is unaffected
    const mail = outbox.filter((m) => m.to === guest.email && m.subject.includes('Booking confirmed'));
    expect(mail).toHaveLength(1); // transactional email is always sent
    expect(id).toBeTruthy();
  });

  it('muting review notifications keeps the review and silences only the host\'s feed', async () => {
    const host = await makeHost(PRICE);
    const guest = await makeGuest();
    await setPrefs(host.owner.token, { inAppReviews: false });
    const b = await completedRow(host.hostel.id, guest.id);
    const review = await reviewsService.create(actorOf(guest, 'GUEST'), b.id, { overall: 5 });
    expect(review.id).toBeTruthy();
    expect((await notificationsFor(host.owner.id)).filter((n) => n.type === 'REVIEW_RECEIVED')).toEqual([]);
  });

  it('account, moderation, KYC and system notices arrive even with everything switched off', async () => {
    const user = await makeUser({ roles: ['OWNER', 'GUEST'] });
    await prisma.notificationPreference.create({ data: { userId: user.id, ...allOff } });
    await notify([
      { userId: user.id, type: 'KYC_APPROVED', title: 'k', body: 'b' }, { userId: user.id, type: 'HOSTEL_REJECTED', title: 'h', body: 'b' }, { userId: user.id, type: 'SYSTEM', title: 's', body: 'b' },
      { userId: user.id, type: 'BOOKING_CONFIRMED', title: 'muted', body: 'b' }, { userId: user.id, type: 'REVIEW_REPLIED', title: 'muted too', body: 'b' },
    ]);
    expect((await notificationsFor(user.id)).map((n) => n.title).sort()).toEqual(['h', 'k', 's']);
  });

  it('a batch mixes recipients correctly: only the muted one is skipped', async () => {
    const quiet = await makeGuest();
    const chatty = await makeGuest();
    const fresh = await makeGuest(); // never saved preferences: defaults apply
    await setPrefs(quiet.token, { inAppBookings: false });
    await notify([quiet, chatty, fresh].map((u) => ({ userId: u.id, type: 'BOOKING_CONFIRMED' as const, title: 'x', body: 'y' })));
    expect(await prisma.notification.count({ where: { userId: quiet.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: chatty.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: fresh.id } })).toBe(1);
    await expect(notify([])).resolves.toBeUndefined();
  });

  it('only the pre-stay reminder email honours the email switch', async () => {
    const host = await makeHost(PRICE);
    const quiet = await makeGuest();
    const chatty = await makeGuest();
    await setPrefs(quiet.token, { emailBookings: false });
    await confirmedBooking(quiet.token, host.hostel.id, host.rooms[0]!.id);
    await confirmedBooking(chatty.token, host.hostel.id, host.rooms[0]!.id);
    expect(outbox.filter((m) => m.to === quiet.email && m.subject.includes('Booking confirmed'))).toHaveLength(1); // confirmation: always

    const sent = await bookingLifecycle.sendReminders(at(addDays(STAY.checkIn, -1)), { hostelId: host.hostel.id });
    expect(sent).toBe(2); // both are reminded in the app...
    expect((await notificationsFor(quiet.id)).map((n) => n.type)).toContain('BOOKING_REMINDER');
    expect(outbox.filter((m) => m.to === quiet.email && m.subject.startsWith('Tomorrow:'))).toHaveLength(0); // ...but only one gets an email
    expect(outbox.filter((m) => m.to === chatty.email && m.subject.startsWith('Tomorrow:'))).toHaveLength(1);
  });
});

describe('devices', () => {
  const token = (p = 'fcm') => `${p}-${'x'.repeat(30)}-${Math.random().toString(36).slice(2, 10)}`;
  const reg = (userToken: string, body: object) => call(registerDevice, { token: userToken, body });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('registers a push token, and re-registering it just refreshes it', async () => {
    const user = await makeGuest();
    const t = token();
    const first = await reg(user.token, { platform: 'ANDROID', pushToken: t });
    expect(first.status).toBe(201);
    expect(issues(deviceDtoSchema, first.body.data)).toEqual([]);
    expect(first.body.data.platform).toBe('ANDROID');
    expect(JSON.stringify(first.body)).not.toContain(t); // the token is never echoed back
    await sleep(15);
    const again = await reg(user.token, { platform: 'ANDROID', pushToken: t });
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(new Date(again.body.data.lastSeenAt).getTime()).toBeGreaterThan(new Date(first.body.data.lastSeenAt).getTime());
    expect(await prisma.device.count({ where: { userId: user.id } })).toBe(1);
  });

  it('a token follows the physical install when another account signs in on it', async () => {
    const a = await makeGuest();
    const b = await makeGuest();
    const t = token();
    await reg(a.token, { platform: 'IOS', pushToken: t });
    await reg(b.token, { platform: 'IOS', pushToken: t });
    expect(await prisma.device.count({ where: { userId: a.id } })).toBe(0);
    expect(await prisma.device.count({ where: { userId: b.id } })).toBe(1);
    expect(await prisma.device.count({ where: { pushToken: t } })).toBe(1);
  });

  it('keeps the ten most recently used installs', async () => {
    const user = await makeGuest();
    const tokens: string[] = [];
    for (let i = 0; i < 12; i++) {
      tokens.push(token(`dev${i}`));
      await reg(user.token, { platform: 'ANDROID', pushToken: tokens[i] });
      await sleep(4);
    }
    const left = (await prisma.device.findMany({ where: { userId: user.id } })).map((d) => d.pushToken).sort();
    expect(left).toEqual(tokens.slice(2).sort());
  });

  it('unregisters on sign-out; other users\' devices are untouchable', async () => {
    const a = await makeGuest();
    const b = await makeGuest();
    const dev = (await reg(a.token, { platform: 'WEB', pushToken: token() })).body.data;
    expect((await call(removeDevice, { method: 'DELETE', token: b.token, params: { id: dev.id } })).status).toBe(404);
    expect(await prisma.device.count({ where: { id: dev.id } })).toBe(1);
    expect((await call(removeDevice, { method: 'DELETE', token: a.token, params: { id: dev.id } })).body.data).toEqual({ deleted: true });
    expect((await call(removeDevice, { method: 'DELETE', token: a.token, params: { id: dev.id } })).status).toBe(404);
    expect((await call(removeDevice, { method: 'DELETE', token: a.token, params: { id: 'bad' } })).status).toBe(404);
  });

  it.each([
    ['a short token', { platform: 'ANDROID', pushToken: 'short' }], ['an oversized token', { platform: 'ANDROID', pushToken: 'x'.repeat(4097) }],
    ['an unknown platform', { platform: 'WINDOWS', pushToken: 'x'.repeat(40) }], ['no platform', { pushToken: 'x'.repeat(40) }], ['no token', { platform: 'IOS' }],
    ['a smuggled user id', { platform: 'IOS', pushToken: 'x'.repeat(40), userId: '00000000-0000-4000-8000-000000000000' }],
  ])('rejects %s (422)', async (_n, body) => {
    const user = await makeGuest();
    expect((await reg(user.token, body)).status).toBe(422);
    expect(await prisma.device.count({ where: { userId: user.id } })).toBe(0);
  });

  it('needs a login', async () => {
    expect((await call(registerDevice, { body: { platform: 'IOS', pushToken: 'x'.repeat(40) } })).status).toBe(401);
    expect((await call(removeDevice, { method: 'DELETE', params: { id: '00000000-0000-4000-8000-000000000000' } })).status).toBe(401);
  });
});

describe('retention', () => {
  it('deletes read notifications after 90 days and anything after a year; keeps the rest', async () => {
    const user = await makeGuest();
    const ago = (days: number) => new Date(Date.now() - days * DAY);
    const oldRead = await seed(user.id, { title: 'old read', createdAt: ago(100), readAt: ago(99) });
    const oldUnread = await seed(user.id, { title: 'old unread', createdAt: ago(100) });
    const ancient = await seed(user.id, { title: 'ancient unread', createdAt: ago(400) });
    const recentRead = await seed(user.id, { title: 'recent read', createdAt: ago(10), readAt: ago(9) });
    const fresh = await seed(user.id, { title: 'fresh' });

    const deleted = await pruneNotifications();
    expect(deleted).toBeGreaterThanOrEqual(2);
    const left = (await prisma.notification.findMany({ where: { userId: user.id } })).map((n) => n.id).sort();
    expect(left).toEqual([oldUnread.id, recentRead.id, fresh.id].sort());
    expect(left).not.toContain(oldRead.id);
    expect(left).not.toContain(ancient.id);
    expect(await pruneNotifications()).toBe(0); // idempotent
    await expect(handlers['prune-notifications']({})).resolves.toBeUndefined();
  });

  it('the worker schedules both maintenance jobs', () => {
    const names = SCHEDULES.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['prune-notifications', 'reconcile-ratings']));
    expect(new Set(names).size).toBe(names.length);
  });
});
