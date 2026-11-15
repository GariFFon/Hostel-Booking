import type { NotificationType, Prisma } from '@/generated/prisma/client';
import { env } from '@/core/config/env';
import { enqueue } from '@/infra/queue/queue';
import { layout } from '@/infra/mail/templates';
import type { Mail } from '@/infra/mail/mailer';
import { loadPreferences, notify } from '@/modules/notifications/notifications.service';

type Tx = Prisma.TransactionClient;
export type Effect = () => Promise<void>;

export type RentEvent = 'invoice_issued' | 'invoice_updated' | 'invoice_voided' | 'due_soon' | 'overdue' | 'paid' | 'payment_reversed' | 'refunded';

export interface RentCtx {
  property: string;
  hostelId: string;
  tenancyId: string;
  invoiceId: string;
  number: string;
  /** Formatted money for the message, e.g. "₹6,000". */
  amount?: string;
  due?: string;
  reason?: string | null;
  audience: 'OWNER' | 'TENANT';
  to: { userId: string; email: string };
}

/** Reminders and bills respect the "rent emails" switch; receipts and corrections are transactional and always sent. */
const MUTABLE_MAIL: ReadonlySet<RentEvent> = new Set(['invoice_issued', 'due_soon', 'overdue']);

function compose(event: RentEvent, c: RentCtx): { type: NotificationType; title: string; body: string; cta: string; url: string } {
  const url = c.audience === 'OWNER' ? `${env().FRONTEND_URL}/owner/rent` : `${env().FRONTEND_URL}/account/stay`;
  const who = c.audience === 'OWNER' ? 'A tenant' : 'You';
  const why = c.reason ? ` Reason: ${c.reason}` : '';
  switch (event) {
    case 'invoice_issued': return { type: 'RENT_INVOICE_ISSUED', title: 'Rent invoice issued', body: `${c.number} for ${c.property}: ${c.amount} due on ${c.due}.`, cta: 'View invoice', url };
    case 'invoice_updated': return { type: 'RENT_INVOICE_ISSUED', title: 'Invoice updated', body: `${c.number} for ${c.property} changed. The amount is now ${c.amount}.${why}`, cta: 'View invoice', url };
    case 'invoice_voided': return { type: 'RENT_INVOICE_ISSUED', title: 'Invoice cancelled', body: `${c.number} for ${c.property} was cancelled, so nothing is due.${why}`, cta: 'View my stay', url };
    case 'due_soon': return { type: 'RENT_DUE_SOON', title: 'Rent due soon', body: `${c.amount} for ${c.property} is due on ${c.due}.`, cta: 'Pay now', url };
    case 'overdue': return { type: 'RENT_OVERDUE', title: 'Rent overdue', body: c.audience === 'OWNER' ? `${c.number} at ${c.property} is overdue (${c.amount} still owed).` : `${c.amount} for ${c.property} was due on ${c.due} and is still unpaid.`, cta: c.audience === 'OWNER' ? 'Open rent' : 'Pay now', url };
    case 'paid': return { type: 'RENT_PAID', title: 'Payment received', body: `${who === 'You' ? 'We received' : 'Received'} ${c.amount} for ${c.number} at ${c.property}.`, cta: 'View receipt', url };
    case 'refunded': return { type: 'RENT_PAID', title: 'Rent refunded', body: `${c.audience === 'OWNER' ? 'A refund of' : 'We refunded'} ${c.amount} for ${c.number} at ${c.property}${c.audience === 'OWNER' ? ' was paid to the tenant' : ' to your original payment method'}.${why}`, cta: c.audience === 'OWNER' ? 'Open rent' : 'View my stay', url };
    case 'payment_reversed': return { type: 'RENT_INVOICE_ISSUED', title: 'Payment reversed', body: `A recorded payment on ${c.number} at ${c.property} was reversed, so ${c.amount} is owed again.${why}`, cta: 'View invoice', url };
  }
}

/** In-app notification inside the transaction, the email as a post-commit effect. */
export async function notifyRent(tx: Tx, event: RentEvent, c: RentCtx): Promise<Effect[]> {
  const n = compose(event, c);
  await notify({ userId: c.to.userId, type: n.type, title: n.title, body: n.body, data: { invoiceId: c.invoiceId, tenancyId: c.tenancyId, hostelId: c.hostelId, number: c.number, audience: c.audience } }, tx);
  if (MUTABLE_MAIL.has(event) && (await loadPreferences(tx, [c.to.userId])).get(c.to.userId)?.emailRent === false) return [];
  const { html, text } = layout(n.title, n.body, n.cta, n.url);
  const mail: Mail = { to: c.to.email, subject: n.title, html, text };
  return [() => enqueue('mail', mail)];
}

export async function runEffects(effects: Effect[]) {
  for (const e of effects) {
    try { await e(); } catch { /* best effort: the change is already committed */ }
  }
}
