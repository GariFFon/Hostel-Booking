import { logger } from '@/core/logger/logger';
import { prisma } from '@/infra/db/prisma';
import { sendMail } from '@/infra/mail/mailer';
import type { JobMap, JobName } from '@/infra/queue/queue';
import { extendHorizon } from '@/modules/availability/inventory.service';
import { expireDueBookings } from '@/modules/bookings/booking-expiry';
import { bookingLifecycle } from '@/modules/bookings/booking-lifecycle.service';
import { notifyAdmins, pruneNotifications } from '@/modules/notifications/notifications.service';
import { reconcileRatings } from '@/modules/reviews/reviews.rating';
import { invalidateHostel } from '@/infra/cache/invalidation';
import { runDemoWebhookJob } from '@/modules/payments/demo-webhook.job';
import { refundsService } from '@/modules/payments/refunds.service';

/** One handler per job name; used by the BullMQ worker and by in-process (inline/test) execution alike. */
export const handlers: { [N in JobName]: (data: JobMap[N]) => Promise<void> } = {
  async mail(mail) {
    // Throwing makes BullMQ retry with backoff; the inline fallback never throws into a request.
    if (!(await sendMail(mail))) throw new Error('mail not delivered');
  },
  async 'demo-webhook'(data) {
    await runDemoWebhookJob(data);
  },
  async 'process-refund'({ refundId }) {
    await refundsService.process(refundId);
  },
  async 'expire-holds'() {
    const n = await expireDueBookings();
    if (n) logger.info({ expired: n }, 'expired booking holds');
  },
  async 'lifecycle-sweep'() {
    const r = await bookingLifecycle.sweep();
    if (r.completed || r.noShows) logger.info(r, 'lifecycle sweep');
  },
  async 'retry-refunds'() {
    const r = await refundsService.retryPending();
    if (r.processed || r.stuck) logger.info(r, 'refund retry');
  },
  async reminders() {
    const n = await bookingLifecycle.sendReminders();
    if (n) logger.info({ reminders: n }, 'sent reminders');
  },
  async 'extend-horizon'() {
    logger.info({ rooms: await extendHorizon(prisma) }, 'inventory horizon extended');
  },
  async 'audit-verify'() {
    const broken = await prisma.$queryRaw<{ bad_id: bigint; reason: string }[]>`SELECT * FROM audit_verify_chain(0)`;
    if (broken.length) {
      logger.error({ broken: broken.slice(0, 5).map((b) => ({ id: String(b.bad_id), reason: b.reason })) }, 'AUDIT CHAIN BROKEN');
      await notifyAdmins({ type: 'SYSTEM', title: 'Audit log integrity check failed', body: `${broken.length} audit row(s) failed verification. Investigate immediately.` });
    }
  },
  async 'prune-notifications'() {
    const n = await pruneNotifications();
    if (n) logger.info({ deleted: n }, 'pruned old notifications');
  },
  async 'reconcile-ratings'() {
    const fixed = await reconcileRatings(prisma);
    if (fixed.length) {
      logger.warn({ hostels: fixed.length }, 'hostel ratings drifted from their reviews and were corrected');
      await Promise.all(fixed.map((id) => invalidateHostel(id)));
    }
  },
};
