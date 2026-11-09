import type { Prisma, NotificationType } from '@/generated/prisma/client';
import { prisma } from '@/infra/db/prisma';
import { DEFAULT_PREFERENCES, NOTIFICATION_CATEGORY, inAppAllowed, type NotificationPreferences } from './notification-policy';

type Db = Prisma.TransactionClient;

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Saved preferences for the given users; anyone without a row gets the defaults. */
export async function loadPreferences(db: Db, userIds: string[]): Promise<Map<string, NotificationPreferences>> {
  const unique = [...new Set(userIds)];
  const rows = unique.length ? await db.notificationPreference.findMany({ where: { userId: { in: unique } } }) : [];
  const saved = new Map(rows.map((r) => [r.userId, { emailBookings: r.emailBookings, emailMarketing: r.emailMarketing, inAppBookings: r.inAppBookings, inAppReviews: r.inAppReviews }]));
  return new Map(unique.map((id) => [id, saved.get(id) ?? DEFAULT_PREFERENCES]));
}

/**
 * Creates in-app notifications, honouring each recipient's preferences (see notification-policy.ts).
 * Pass the active transaction so they commit with the change that caused them.
 */
export async function notify(input: NotifyInput | NotifyInput[], db: Db = prisma) {
  const list = Array.isArray(input) ? input : [input];
  if (list.length === 0) return;
  const mutable = list.filter((n) => NOTIFICATION_CATEGORY[n.type] !== 'always');
  const prefs = mutable.length ? await loadPreferences(db, mutable.map((n) => n.userId)) : new Map<string, NotificationPreferences>();
  const wanted = list.filter((n) => inAppAllowed(n.type, prefs.get(n.userId) ?? DEFAULT_PREFERENCES));
  if (wanted.length === 0) return;
  await db.notification.createMany({
    data: wanted.map((n) => ({ userId: n.userId, type: n.type, title: n.title, body: n.body, data: n.data as Prisma.InputJsonValue | undefined })),
  });
}

export async function notifyAdmins(input: Omit<NotifyInput, 'userId'>, db: Db = prisma) {
  const admins = await db.userRoleAssignment.findMany({ where: { role: 'ADMIN', user: { status: 'ACTIVE', deletedAt: null } }, select: { userId: true } });
  await notify(admins.map((a) => ({ ...input, userId: a.userId })), db);
}

const READ_RETENTION_DAYS = 90;
const MAX_RETENTION_DAYS = 365;
const PRUNE_BATCH = 5000;

/**
 * Retention: read notifications are deleted after 90 days, everything else after a year. Deletes in batches so a
 * large backlog never holds a long lock. Returns how many rows were removed.
 */
export async function pruneNotifications(now = new Date(), db: Pick<typeof prisma, '$executeRaw'> = prisma): Promise<number> {
  const readCutoff = new Date(now.getTime() - READ_RETENTION_DAYS * 86_400_000);
  const maxCutoff = new Date(now.getTime() - MAX_RETENTION_DAYS * 86_400_000);
  let total = 0;
  for (let i = 0; i < 200; i++) {
    const n = await db.$executeRaw`
      DELETE FROM notifications WHERE id IN (
        SELECT id FROM notifications WHERE (read_at IS NOT NULL AND created_at < ${readCutoff}) OR created_at < ${maxCutoff} LIMIT ${PRUNE_BATCH})`;
    total += n;
    if (n < PRUNE_BATCH) break;
  }
  return total;
}
