import type { Prisma } from '@/generated/prisma/client';
import { logger } from '@/core/logger/logger';
import { prisma } from '@/infra/db/prisma';
import { sendPush } from '@/infra/push/push';

/** A notification older than this is never pushed (a phone buzzing about last week is worse than silence). */
const MAX_AGE_MS = 60 * 60_000;
const BATCH = 200;

/** Flattens the deep-link hints into the string-only map FCM wants. Objects and nulls are dropped. */
function pushData(type: string, id: string, data: Prisma.JsonValue | null): Record<string, string> {
  const out: Record<string, string> = { notificationId: id, type };
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [k, v] of Object.entries(data)) if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}

/**
 * Takes the notifications nobody has pushed yet and sends each to all of the user's phones, once.
 * The claim (`pushed_at`) is a single atomic UPDATE, so several workers (or a retry) never send the same notification twice.
 * Delivery is at-most-once on purpose: the notification is always in the in-app list, and a duplicate buzz is worse than a missed one.
 * Stale ones are marked done without sending. Dead tokens are deleted.
 */
export async function dispatchPushes(now = new Date()): Promise<{ sent: number; skipped: number; removed: number }> {
  const claimed = await prisma.$queryRaw<{ id: string; user_id: string; type: string; title: string; body: string; data: Prisma.JsonValue | null; created_at: Date }[]>`
    UPDATE notifications SET pushed_at = ${now}
    WHERE id IN (SELECT id FROM notifications WHERE pushed_at IS NULL ORDER BY created_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
    RETURNING id, user_id, type::text AS type, title, body, data, created_at`;
  const fresh = claimed.filter((n) => now.getTime() - n.created_at.getTime() <= MAX_AGE_MS);
  if (fresh.length === 0) return { sent: 0, skipped: claimed.length, removed: 0 };

  const devices = await prisma.device.findMany({ where: { userId: { in: [...new Set(fresh.map((n) => n.user_id))] } }, select: { id: true, userId: true, pushToken: true } });
  const byUser = new Map<string, typeof devices>();
  for (const d of devices) byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d]);

  let sent = 0;
  const dead: string[] = [];
  for (const n of fresh) {
    for (const d of byUser.get(n.user_id) ?? []) {
      const r = await sendPush({ token: d.pushToken, title: n.title, body: n.body, data: pushData(n.type, n.id, n.data) });
      if (r === 'sent') sent++;
      else if (r === 'dead') dead.push(d.id);
    }
  }
  if (dead.length) await prisma.device.deleteMany({ where: { id: { in: [...new Set(dead)] } } });
  if (sent || dead.length) logger.info({ sent, removed: dead.length }, 'push dispatched');
  return { sent, skipped: claimed.length - fresh.length, removed: new Set(dead).size };
}
