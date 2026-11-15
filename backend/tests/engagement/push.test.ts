import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/infra/db/prisma';
import { pushOutbox, pushResults, setPushDriver } from '@/infra/push/push';
import { captured, setQueueMode } from '@/infra/queue/queue';
import { redis } from '@/infra/redis/redis';
import { POST as registerDevice } from '@/app/api/v1/me/devices/route';
import { dispatchPushes } from '@/modules/notifications/push-dispatch.service';
import { notify } from '@/modules/notifications/notifications.service';
import { call } from '../helpers/http';
import { makeGuest } from '../helpers/booking';

beforeAll(async () => {
  await redis.flushdb();
});

const token = (n: string) => `fcm-token-${n}-${'x'.repeat(20)}`;
const device = async (userToken: string, pushToken: string) => {
  const r = await call(registerDevice, { method: 'POST', token: userToken, body: { platform: 'ANDROID', pushToken } });
  expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
};
const setPrefs = (userId: string, data: object) => prisma.notificationPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data });

// Other suites leave unpushed notifications behind; start from a drained queue so only this test's own are in play.
beforeEach(async () => {
  await prisma.notification.updateMany({ where: { pushedAt: null }, data: { pushedAt: new Date() } });
  setPushDriver('log');
  setQueueMode('capture'); // dispatch runs only when the test asks (inline mode would run it inside notify)
  captured.length = 0;
  pushOutbox.length = 0;
  pushResults.clear();
});
afterEach(() => {
  setPushDriver(null);
  setQueueMode(null);
});

describe('push delivery', () => {
  it('sends a new notification to every phone the user has, with the deep-link data as strings', async () => {
    const user = await makeGuest();
    await device(user.token, token('a'));
    await device(user.token, token('b'));
    await notify({ userId: user.id, type: 'RENT_OVERDUE', title: 'Rent overdue', body: 'INV-1 is overdue', data: { invoiceId: 'i1', audience: 'TENANT', amount: 5000, nested: { no: 1 }, nothing: null } });
    const r = await dispatchPushes();
    expect(r.sent).toBe(2);
    expect(pushOutbox.map((m) => m.token).sort()).toEqual([token('a'), token('b')]);
    expect(pushOutbox[0]).toMatchObject({ title: 'Rent overdue', body: 'INV-1 is overdue' });
    expect(pushOutbox[0]!.data).toMatchObject({ type: 'RENT_OVERDUE', invoiceId: 'i1', audience: 'TENANT', amount: '5000' });
    expect(pushOutbox[0]!.data).not.toHaveProperty('nested');
    expect(pushOutbox[0]!.data).not.toHaveProperty('nothing');
    expect(pushOutbox[0]!.data.notificationId).toBeTruthy();
  });

  it('sends each notification once, however often the dispatcher runs', async () => {
    const user = await makeGuest();
    await device(user.token, token('once'));
    await notify({ userId: user.id, type: 'SYSTEM', title: 'Hello', body: 'x' });
    await Promise.all([dispatchPushes(), dispatchPushes(), dispatchPushes()]);
    await dispatchPushes();
    expect(pushOutbox.filter((m) => m.token === token('once'))).toHaveLength(1);
    expect(await prisma.notification.count({ where: { userId: user.id, pushedAt: null } })).toBe(0);
  });

  it('follows the notification switches: a muted category sends no push, an always-on notice still does', async () => {
    const user = await makeGuest();
    await device(user.token, token('prefs'));
    await setPrefs(user.id, { inAppComplaints: false });
    await notify({ userId: user.id, type: 'COMPLAINT_UPDATED', title: 'muted', body: 'x' }); // never even created
    await notify({ userId: user.id, type: 'KYC_APPROVED', title: 'always', body: 'x' });
    await dispatchPushes();
    expect(pushOutbox.map((m) => m.title)).toEqual(['always']);
  });

  it('does nothing for a user with no phone registered, and still marks it handled', async () => {
    const user = await makeGuest();
    await notify({ userId: user.id, type: 'SYSTEM', title: 'No phone', body: 'x' });
    const r = await dispatchPushes();
    expect(r.sent).toBe(0);
    expect(await prisma.notification.count({ where: { userId: user.id, pushedAt: null } })).toBe(0);
  });

  it('forgets a token the push service says is dead, and keeps the live ones', async () => {
    const user = await makeGuest();
    await device(user.token, token('dead'));
    await device(user.token, token('live'));
    pushResults.set(token('dead'), 'dead');
    await notify({ userId: user.id, type: 'SYSTEM', title: 'x', body: 'y' });
    const r = await dispatchPushes();
    expect(r).toMatchObject({ sent: 1, removed: 1 });
    expect((await prisma.device.findMany({ where: { userId: user.id } })).map((d) => d.pushToken)).toEqual([token('live')]);
  });

  it('a temporary failure keeps the device and does not break the notification or later ones', async () => {
    const user = await makeGuest();
    await device(user.token, token('flaky'));
    pushResults.set(token('flaky'), 'failed');
    await notify({ userId: user.id, type: 'SYSTEM', title: 'first', body: 'y' });
    expect((await dispatchPushes()).sent).toBe(0);
    expect(await prisma.device.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1); // still in the in-app list
    pushResults.clear();
    await notify({ userId: user.id, type: 'SYSTEM', title: 'second', body: 'y' });
    await dispatchPushes();
    expect(pushOutbox.map((m) => m.title)).toEqual(['first', 'second']); // the first was tried and not lost track of; the second went out normally
  });

  it('never pushes an old notification (older than an hour), but still marks it handled', async () => {
    const user = await makeGuest();
    await device(user.token, token('old'));
    await prisma.notification.create({ data: { userId: user.id, type: 'SYSTEM', title: 'ancient', body: 'x', createdAt: new Date(Date.now() - 3 * 3600_000) } });
    const r = await dispatchPushes();
    expect(r.sent).toBe(0);
    expect(pushOutbox).toHaveLength(0);
    expect(await prisma.notification.count({ where: { userId: user.id, pushedAt: null } })).toBe(0);
  });

  it('only people with a phone registered get a push: another user\'s phone is never used', async () => {
    const a = await makeGuest();
    const b = await makeGuest();
    await device(b.token, token('bphone'));
    await notify({ userId: a.id, type: 'SYSTEM', title: 'for a', body: 'x' });
    await dispatchPushes();
    expect(pushOutbox).toHaveLength(0);
  });

  it('asks for a dispatch right after writing a notification, but only when push is on', async () => {
    const user = await makeGuest();
    await notify({ userId: user.id, type: 'SYSTEM', title: 'a', body: 'b' });
    expect(captured.filter((j) => j.name === 'push-dispatch')).toHaveLength(1);
    captured.length = 0;
    setPushDriver('off');
    await notify({ userId: user.id, type: 'SYSTEM', title: 'c', body: 'd' });
    expect(captured).toHaveLength(0);
  });
});
