import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Worker } from 'bullmq';
import { prisma } from '@/infra/db/prisma';
import { outbox } from '@/infra/mail/mailer';
import { closeQueue, enqueue, getQueue, setQueueMode } from '@/infra/queue/queue';
import { SCHEDULES, registerSchedules, startWorker } from '@/worker';
import { handlers } from '@/jobs/handlers';
import { book, bookingBody, makeGuest, makeHost } from '../helpers/booking';
import { uniq } from '../helpers/publish';

let worker: Worker;

/** Polls until `fn` is truthy (the worker runs in the background). */
async function until<T>(fn: () => Promise<T | false | undefined> | T | false | undefined, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error('timed out waiting for the worker');
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  setQueueMode('bullmq'); // real BullMQ on the test Redis (separate key prefix per APP_ENV)
  await getQueue().obliterate({ force: true });
  worker = startWorker({ concurrency: 3 });
});
afterAll(async () => {
  await worker.close();
  await closeQueue();
  setQueueMode(null);
});

describe('BullMQ worker', () => {
  it('delivers mail through the real queue', async () => {
    const to = `${uniq('queued')}@test.dev`;
    await enqueue('mail', { to, subject: 'Queued hello', html: '<p>hi</p>', text: 'hi' });
    await until(() => outbox.find((m) => m.to === to));
    expect(outbox.filter((m) => m.to === to)).toHaveLength(1);
  });

  it('registers every recurring schedule exactly once, however often the worker starts', async () => {
    await registerSchedules();
    await registerSchedules();
    const schedulers = await getQueue().getJobSchedulers();
    expect(schedulers.map((s) => s.key).sort()).toEqual(SCHEDULES.map((s) => `schedule:${s.name}`).sort());
    expect(schedulers.find((s) => s.key === 'schedule:expire-holds')?.every).toBe(30_000);
  });

  it('runs the expiry sweeper job against real data', async () => {
    const host = await makeHost({ rooms: [{ units: 2 }] });
    const guest = await makeGuest();
    const b = (await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id))).body.data;
    await prisma.booking.update({ where: { id: b.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    await enqueue('expire-holds', {});
    await until(async () => (await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status === 'EXPIRED');
  });

  it('retries a failing job with backoff, then succeeds', async () => {
    let calls = 0;
    const original = handlers.reminders;
    handlers.reminders = async () => { if (++calls < 3) throw new Error('transient failure'); };
    try {
      await getQueue().add('reminders', {}, { attempts: 4, backoff: { type: 'fixed', delay: 50 } });
      await until(() => calls >= 3);
      expect(calls).toBe(3);
    } finally {
      handlers.reminders = original;
    }
  });

  it('every job name has a handler', () => {
    expect(Object.keys(handlers).sort()).toEqual(['audit-verify', 'demo-webhook', 'expire-holds', 'extend-horizon', 'lifecycle-sweep', 'mail', 'process-refund', 'prune-notifications', 'reconcile-ratings', 'reminders', 'retry-refunds']);
  });
});
