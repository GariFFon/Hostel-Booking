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
import { depositsService } from '@/modules/tenancies/deposits.service';
import { rentRefundsService } from '@/modules/rent/rent-refunds.service';
import { refundsService } from '@/modules/payments/refunds.service';
import { sweepTenancies } from '@/modules/tenancies/tenancy-sweep.service';
import { runRentDemoWebhookJob } from '@/modules/rent/rent-demo-webhook.job';
import { sweepRent } from '@/modules/rent/rent-sweep.service';
import { dispatchPushes } from '@/modules/notifications/push-dispatch.service';
import { sweepComplaints } from '@/modules/complaints/complaints-sweep.service';

/** One handler per job name; used by the BullMQ worker and by in-process (inline/test) execution alike. */
export const handlers: { [N in JobName]: (data: JobMap[N]) => Promise<void> } = {
  async mail(mail) {
    // Throwing makes BullMQ retry with backoff; the inline fallback never throws into a request.
    if (!(await sendMail(mail))) throw new Error('mail not delivered');
  },
  async 'push-dispatch'() {
    await dispatchPushes();
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
    const deposits = await depositsService.retryPending();
    if (deposits.completed || deposits.stuck) logger.info(deposits, 'deposit refund retry');
    const rent = await rentRefundsService.retryPending();
    if (rent.processed || rent.stuck) logger.info(rent, 'rent refund retry');
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
  async 'rent-demo-webhook'(data) {
    await runRentDemoWebhookJob(data);
  },
  async 'complaint-sweep'() {
    const r = await sweepComplaints();
    if (r.breached || r.closed) logger.info(r, 'complaint sweep');
  },
  async 'rent-sweep'() {
    const r = await sweepRent();
    if (r.issued || r.lateFees || r.dueSoon || r.overdue) logger.info(r, 'rent sweep');
  },
  async 'tenancy-sweep'() {
    const r = await sweepTenancies();
    if (r.expiredApplications || r.expiredInvites) logger.info(r, 'tenancy sweep');
  },
  async 'reconcile-ratings'() {
    const fixed = await reconcileRatings(prisma);
    if (fixed.length) {
      logger.warn({ hostels: fixed.length }, 'hostel ratings drifted from their reviews and were corrected');
      await Promise.all(fixed.map((id) => invalidateHostel(id)));
    }
  },
};
