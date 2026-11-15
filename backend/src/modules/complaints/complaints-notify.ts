import type { NotificationType, Prisma } from '@/generated/prisma/client';
import { env } from '@/core/config/env';
import { enqueue } from '@/infra/queue/queue';
import { layout } from '@/infra/mail/templates';
import { notify, type NotifyInput } from '@/modules/notifications/notifications.service';
import type { ComplaintFull } from './complaints.mapper';

type Tx = Prisma.TransactionClient;
export type Effect = () => Promise<void>;
export type Party = 'TENANT' | 'OWNER' | 'STAFF';

export interface Note {
  to: Party;
  type: NotificationType;
  title: string;
  body: string;
  /** Also send an email (reserved for things a person must not miss: a job assigned to them, their complaint resolved). */
  mail?: boolean;
}

const urlFor = (party: Party, id: string) => {
  const base = env().FRONTEND_URL;
  return party === 'OWNER' ? `${base}/owner/complaints` : party === 'STAFF' ? `${base}/staff` : `${base}/account/complaints?open=${id}`;
};

/** In-app notifications inside the transaction; emails as post-commit effects so a mail outage never undoes a change. */
export async function notifyComplaint(tx: Tx, c: ComplaintFull, notes: Note[]): Promise<Effect[]> {
  const people: Record<Party, { id: string; email: string } | null> = {
    TENANT: { id: c.raisedBy.id, email: c.raisedBy.email },
    OWNER: { id: c.hostel.ownerId, email: c.hostel.owner.email },
    STAFF: c.assigned ? { id: c.assigned.id, email: c.assigned.email } : null,
  };
  const effects: Effect[] = [];
  const rows: NotifyInput[] = [];
  for (const n of notes) {
    const who = people[n.to];
    if (!who) continue;
    rows.push({ userId: who.id, type: n.type, title: n.title, body: n.body, data: { complaintId: c.id, code: c.code, hostelId: c.hostelId, audience: n.to } });
    if (n.mail) {
      const { html, text } = layout(n.title, n.body, 'Open', urlFor(n.to, c.id));
      const mail = { to: who.email, subject: n.title, html, text };
      effects.push(() => enqueue('mail', mail));
    }
  }
  await notify(rows, tx);
  return effects;
}

export async function runEffects(effects: Effect[]) {
  for (const e of effects) {
    try { await e(); } catch { /* best effort: the change is already committed */ }
  }
}
