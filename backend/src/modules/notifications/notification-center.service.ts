import type { Notification, Prisma } from '@/generated/prisma/client';
import type { Actor } from '@/core/context/request-context';
import { Errors } from '@/core/errors/app-error';
import { cursorArgs, toPage } from '@/core/http/pagination';
import { prisma } from '@/infra/db/prisma';
import { recordAudit } from '@/modules/audit/audit.service';
import { DEFAULT_PREFERENCES, type NotificationPreferences } from './notification-policy';

const MAX_DEVICES_PER_USER = 10;

const toDto = (n: Notification) => ({
  id: n.id, type: n.type, title: n.title, body: n.body,
  data: (n.data as Record<string, unknown> | null) ?? null,
  read: n.readAt !== null, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString(),
});

const toPrefs = (p: NotificationPreferences): NotificationPreferences => ({ emailBookings: p.emailBookings, emailMarketing: p.emailMarketing, inAppBookings: p.inAppBookings, inAppReviews: p.inAppReviews });

/** The caller's own notifications. Every query is scoped by `userId`, so another user's id is just "not found". */
export const notificationCenter = {
  async list(actor: Actor, q: { limit: number; cursor?: string; unread?: 'true' | 'false'; type?: Notification['type'] }) {
    const where: Prisma.NotificationWhereInput = { userId: actor.id, ...(q.unread === 'true' ? { readAt: null } : {}), ...(q.type ? { type: q.type } : {}) };
    const rows = await prisma.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q) });
    const { items, nextCursor } = toPage(rows, q.limit);
    return { items: items.map(toDto), nextCursor };
  },

  async unreadCount(actor: Actor) {
    return { unread: await prisma.notification.count({ where: { userId: actor.id, readAt: null } }) };
  },

  /** Idempotent: reading an already-read notification keeps its original read time. */
  async markRead(actor: Actor, id: string) {
    const existing = await prisma.notification.findFirst({ where: { id, userId: actor.id } });
    if (!existing) throw Errors.notFound('Notification');
    if (existing.readAt) return toDto(existing);
    await prisma.notification.updateMany({ where: { id, userId: actor.id, readAt: null }, data: { readAt: new Date() } });
    return toDto(await prisma.notification.findUniqueOrThrow({ where: { id } }));
  },

  async markAllRead(actor: Actor) {
    const { count } = await prisma.notification.updateMany({ where: { userId: actor.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: count };
  },

  async remove(actor: Actor, id: string) {
    const { count } = await prisma.notification.deleteMany({ where: { id, userId: actor.id } });
    if (count === 0) throw Errors.notFound('Notification');
  },

  // ── preferences ──
  async getPreferences(actor: Actor): Promise<NotificationPreferences> {
    const row = await prisma.notificationPreference.findUnique({ where: { userId: actor.id } });
    return row ? toPrefs(row) : { ...DEFAULT_PREFERENCES };
  },

  async updatePreferences(actor: Actor, patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    return prisma.$transaction(async (tx) => {
      const before = await tx.notificationPreference.findUnique({ where: { userId: actor.id } });
      const row = await tx.notificationPreference.upsert({ where: { userId: actor.id }, create: { userId: actor.id, ...patch }, update: patch });
      // Marketing consent changes are audited: they are the one preference with a legal meaning.
      await recordAudit({ action: 'notification.preferences.update', entityType: 'user', entityId: actor.id, before: before ? toPrefs(before) : DEFAULT_PREFERENCES, after: toPrefs(row) }, tx);
      return toPrefs(row);
    });
  },

  // ── devices (push delivery itself is a later phase; clients register tokens now so it can be switched on) ──
  /**
   * Registers (or refreshes) a push token. A token belongs to one physical install, so if it is already
   * registered to another account (shared phone, sign-out/sign-in) it moves to the current user.
   */
  async registerDevice(actor: Actor, input: { platform: 'ANDROID' | 'IOS' | 'WEB'; pushToken: string }) {
    const device = await prisma.$transaction(async (tx) => {
      const d = await tx.device.upsert({
        where: { pushToken: input.pushToken },
        create: { userId: actor.id, platform: input.platform, pushToken: input.pushToken },
        update: { userId: actor.id, platform: input.platform, lastSeenAt: new Date() },
      });
      // Keep the most recently used installs only.
      const stale = await tx.device.findMany({ where: { userId: actor.id }, orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }], skip: MAX_DEVICES_PER_USER, select: { id: true } });
      if (stale.length) await tx.device.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
      return d;
    });
    return { id: device.id, platform: device.platform, createdAt: device.createdAt.toISOString(), lastSeenAt: device.lastSeenAt.toISOString() };
  },

  async removeDevice(actor: Actor, id: string) {
    const { count } = await prisma.device.deleteMany({ where: { id, userId: actor.id } });
    if (count === 0) throw Errors.notFound('Device');
  },
};
