import type { NotificationType, Prisma } from '@/generated/prisma/client';
import { env } from '@/core/config/env';
import { enqueue } from '@/infra/queue/queue';
import { layout } from '@/infra/mail/templates';
import type { Mail } from '@/infra/mail/mailer';
import { invalidateInventory } from '@/infra/cache/invalidation';
import { notify } from '@/modules/notifications/notifications.service';

/** A bed was taken or freed: dated search results (which count free beds) must not stay cached. */
export const bedsChangedEffect = (): Effect => () => invalidateInventory();

type Tx = Prisma.TransactionClient;
export type Effect = () => Promise<void>;

export type TenancyEvent =
  | 'application_requested' // to the owner
  | 'application_approved' // to the applicant
  | 'application_rejected'
  | 'application_expired'
  | 'invited' // to the invited tenant
  | 'invite_accepted' // to the owner
  | 'invite_declined'
  | 'started' // move-in recorded: both sides
  | 'cancelled' // tenancy cancelled before move-in: the other side
  | 'deposit_paid' // the deposit arrived online: both sides
  | 'notice_given' // the other side
  | 'notice_withdrawn'
  | 'ended' // moved out: both sides
  | 'settlement_proposed' // to the tenant
  | 'settlement_disputed' // to the owner
  | 'settlement_agreed' // to the owner (the tenant accepted, or the 7 days passed)
  | 'settlement_completed'; // the refund is done: both sides

interface Ctx {
  property: string;
  tenancyId?: string;
  applicationId?: string;
  hostelId: string;
  code?: string;
  reason?: string | null;
  /** Formatted money, e.g. "₹6,000". */
  amount?: string;
  /** A formatted date, e.g. the move-out date. */
  date?: string;
  /** Who gets the notification. */
  to: { userId?: string; email: string };
  /** Present only for an invite sent to an unregistered address. */
  inviteToken?: string;
  /** Which screen the recipient should land on. Defaults from the event; pass it when an event goes to both sides. */
  audience?: 'OWNER' | 'TENANT';
}

const OWNER_EVENTS: ReadonlySet<TenancyEvent> = new Set(['application_requested', 'invite_accepted', 'invite_declined', 'settlement_disputed', 'settlement_agreed']);

const tenantUrl = (c: Ctx) => `${env().FRONTEND_URL}/account/stay${c.inviteToken ? `?invite=${encodeURIComponent(c.inviteToken)}` : ''}`;
const ownerUrl = () => `${env().FRONTEND_URL}/owner/tenants`;

function compose(event: TenancyEvent, c: Ctx): { type: NotificationType; title: string; body: string; cta: string; url: string } {
  const why = c.reason ? ` Reason: ${c.reason}` : '';
  switch (event) {
    case 'application_requested': return { type: 'TENANCY_REQUESTED', title: 'New tenancy request', body: `Someone wants a bed at ${c.property}.`, cta: 'Review request', url: ownerUrl() };
    case 'application_approved': return { type: 'TENANCY_APPROVED', title: 'Your request was approved', body: `${c.property} has reserved a bed for you. The owner will confirm your move-in.`, cta: 'View my stay', url: tenantUrl(c) };
    case 'application_rejected': return { type: 'TENANCY_REJECTED', title: 'Your request was declined', body: `${c.property} could not offer you a bed.${why}`, cta: 'Find another place', url: `${env().FRONTEND_URL}/search` };
    case 'application_expired': return { type: 'TENANCY_REJECTED', title: 'Your request expired', body: `${c.property} did not respond in time, so your request was closed.`, cta: 'Find another place', url: `${env().FRONTEND_URL}/search` };
    case 'invited': return { type: 'TENANCY_INVITED', title: 'You were added to a stay', body: `${c.property} added you as a tenant. Accept to confirm it.`, cta: 'Accept invitation', url: tenantUrl(c) };
    case 'invite_accepted': return { type: 'TENANCY_APPROVED', title: 'Tenant accepted', body: `A tenant accepted the invitation to ${c.property}.`, cta: 'Open tenants', url: ownerUrl() };
    case 'invite_declined': return { type: 'TENANCY_ENDED', title: 'Tenant declined', body: `A tenant declined the stay at ${c.property}.${why}`, cta: 'Open tenants', url: ownerUrl() };
    case 'started': return { type: 'TENANCY_STARTED', title: 'Move-in recorded', body: `The stay at ${c.property} has started.`, cta: 'View my stay', url: tenantUrl(c) };
    case 'deposit_paid': return { type: 'RENT_PAID', title: 'Deposit received', body: c.audience === 'OWNER' ? `A tenant paid the ${c.amount} deposit online for ${c.property}.` : `We received your ${c.amount} deposit for ${c.property}. The owner will confirm your move-in.`, cta: c.audience === 'OWNER' ? 'Open tenants' : 'View my stay', url: c.audience === 'OWNER' ? ownerUrl() : tenantUrl(c) };
    case 'notice_given': return { type: 'TENANCY_NOTICE', title: 'Notice given', body: `Notice was given for the stay at ${c.property}. Move-out is on ${c.date}.${why}`, cta: c.audience === 'OWNER' ? 'Open tenants' : 'View my stay', url: c.audience === 'OWNER' ? ownerUrl() : tenantUrl(c) };
    case 'notice_withdrawn': return { type: 'TENANCY_NOTICE', title: 'Notice withdrawn', body: `The notice for the stay at ${c.property} was withdrawn, so the stay continues.`, cta: c.audience === 'OWNER' ? 'Open tenants' : 'View my stay', url: c.audience === 'OWNER' ? ownerUrl() : tenantUrl(c) };
    case 'ended': return { type: 'TENANCY_ENDED', title: 'Stay ended', body: `The stay at ${c.property} has ended${c.date ? ` (moved out ${c.date})` : ''}.${c.amount ? ` ${c.amount} of the deposit is being settled.` : ''}`, cta: c.audience === 'OWNER' ? 'Settle the deposit' : 'View my stay', url: c.audience === 'OWNER' ? ownerUrl() : tenantUrl(c) };
    case 'settlement_proposed': return { type: 'DEPOSIT_SETTLED', title: 'Your deposit settlement is ready', body: `${c.property} has itemised your deposit: ${c.amount} comes back to you. Review it within 7 days; if you say nothing it is taken as accepted.`, cta: 'Review settlement', url: tenantUrl(c) };
    case 'settlement_disputed': return { type: 'DEPOSIT_SETTLED', title: 'Deposit settlement disputed', body: `The tenant disputed the deposit settlement for ${c.property}.${why}`, cta: 'Open tenants', url: ownerUrl() };
    case 'settlement_agreed': return { type: 'DEPOSIT_SETTLED', title: 'Deposit settlement agreed', body: `The deposit settlement for ${c.property} was accepted${c.reason ? ` (${c.reason})` : ''}. ${c.amount} goes back to the tenant.`, cta: 'Open tenants', url: ownerUrl() };
    case 'settlement_completed': return { type: 'DEPOSIT_SETTLED', title: 'Deposit settled', body: c.audience === 'OWNER' ? `The deposit settlement for ${c.property} is complete (${c.amount} returned).` : `Your deposit settlement for ${c.property} is complete. ${c.amount} was returned to you.`, cta: c.audience === 'OWNER' ? 'Open tenants' : 'View my stay', url: c.audience === 'OWNER' ? ownerUrl() : tenantUrl(c) };
    case 'cancelled': return { type: 'TENANCY_ENDED', title: 'Stay cancelled', body: `The stay at ${c.property} was cancelled before move-in.${why}`, cta: 'Open', url: tenantUrl(c) };
  }
}

/**
 * In-app notification inside the transaction, plus the email as a post-commit effect (a mail outage can never roll back a decision).
 * Mail goes to `to.email` even for people without an account yet (invites).
 */
export async function notifyTenancy(tx: Tx, event: TenancyEvent, c: Ctx): Promise<Effect[]> {
  const n = compose(event, c);
  if (c.to.userId) await notify({ userId: c.to.userId, type: n.type, title: n.title, body: n.body, data: { tenancyId: c.tenancyId, applicationId: c.applicationId, hostelId: c.hostelId, code: c.code, audience: c.audience ?? (OWNER_EVENTS.has(event) ? 'OWNER' : 'TENANT') } }, tx);
  const { html, text } = layout(n.title, n.body, n.cta, n.url);
  const mail: Mail = { to: c.to.email, subject: n.title, html, text };
  return [() => enqueue('mail', mail)];
}

export async function runEffects(effects: Effect[]) {
  for (const e of effects) {
    try { await e(); } catch { /* best effort: the decision is already committed */ }
  }
}
