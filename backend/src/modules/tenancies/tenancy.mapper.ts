import type { Prisma } from '@/generated/prisma/client';
import { toDateString } from '@/core/dates';
import { depositWarning } from './tenancy.rules';

const hostelSelect = { select: { id: true, slug: true, name: true, city: true, addressLine1: true } } as const;
const roomSelect = { select: { id: true, name: true, kind: true } } as const;
const personSelect = { select: { id: true, email: true, profile: { select: { fullName: true, phone: true } } } } as const;

export const applicationInclude = { hostel: hostelSelect, roomType: roomSelect, applicant: personSelect, tenancy: { select: { id: true } } } satisfies Prisma.TenancyApplicationInclude;
export const tenancyInclude = { hostel: hostelSelect, roomType: roomSelect, unit: { select: { id: true, label: true, floor: true } }, tenant: personSelect, settlement: { select: { id: true, status: true, refundPaise: true } } } satisfies Prisma.TenancyInclude;

export type ApplicationFull = Prisma.TenancyApplicationGetPayload<{ include: typeof applicationInclude }>;
export type TenancyFull = Prisma.TenancyGetPayload<{ include: typeof tenancyInclude }>;
export type Viewer = 'TENANT' | 'OWNER' | 'ADMIN';

const person = (u: { id: string; email: string; profile: { fullName: string; phone: string | null } | null }) => ({ id: u.id, name: u.profile?.fullName ?? null, email: u.email, phone: u.profile?.phone ?? null });
const hostelRef = (h: ApplicationFull['hostel']) => ({ id: h.id, slug: h.slug, name: h.name, city: h.city, addressLine: h.addressLine1 });

export function toApplicationDto(a: ApplicationFull, viewer: Viewer) {
  const open = a.status === 'REQUESTED';
  return {
    id: a.id, status: a.status, hostel: hostelRef(a.hostel), roomType: a.roomType, applicant: person(a.applicant),
    moveInDate: toDateString(a.moveInDate), tenureMonths: a.tenureMonths, gender: a.gender, occupation: a.occupation, message: a.message,
    emergencyContact: { name: a.emergencyContactName, phone: a.emergencyContactPhone }, decisionNote: a.decisionNote, decidedAt: a.decidedAt?.toISOString() ?? null,
    tenancyId: a.tenancy?.id ?? null, createdAt: a.createdAt.toISOString(),
    actions: open ? (viewer === 'TENANT' ? (['withdraw'] as const) : viewer === 'OWNER' ? (['approve', 'reject'] as const) : ([] as const)) : ([] as const),
  };
}

export function toTenancyDto(t: TenancyFull, viewer: Viewer) {
  const depositStatus = t.depositPaise === 0 ? 'NONE' : t.depositReceivedAt ? 'RECEIVED' : 'DUE';
  const pre = t.status === 'INVITED' || t.status === 'PENDING_MOVE_IN';
  const actions: ('accept' | 'decline' | 'edit' | 'record_deposit' | 'activate' | 'cancel' | 'give_notice' | 'withdraw_notice' | 'pay_deposit' | 'serve_notice' | 'move_out' | 'settle')[] = [];
  if (viewer === 'TENANT' && t.tenantId) {
    if (t.status === 'INVITED') actions.push('accept', 'decline');
    else if (t.status === 'PENDING_MOVE_IN') actions.push('decline');
    if (t.status === 'ACTIVE') actions.push('give_notice');
    if (t.status === 'NOTICE' && t.noticeBy === 'TENANT') actions.push('withdraw_notice');
    if (depositStatus === 'DUE' && (t.status === 'PENDING_MOVE_IN' || t.status === 'ACTIVE')) actions.push('pay_deposit');
  }
  if (viewer === 'OWNER') {
    if (pre) actions.push('edit');
    if ((pre || t.status === 'ACTIVE') && depositStatus === 'DUE') actions.push('record_deposit');
    if (t.status === 'PENDING_MOVE_IN') actions.push('activate');
    if (pre) actions.push('cancel');
    if (t.status === 'ACTIVE') actions.push('serve_notice');
    if (t.status === 'NOTICE' && t.noticeBy === 'OWNER') actions.push('withdraw_notice');
    if (t.status === 'ACTIVE' || t.status === 'NOTICE') actions.push('move_out');
    if (t.status === 'ENDED' && depositStatus === 'RECEIVED') actions.push('settle');
  }
  return {
    id: t.id, code: t.code, status: t.status, hostel: hostelRef(t.hostel as ApplicationFull['hostel']), roomType: t.roomType, unit: t.unit,
    tenant: t.tenant ? person(t.tenant) : null, inviteEmail: t.inviteEmail,
    startDate: toDateString(t.startDate), endDate: t.endDate ? toDateString(t.endDate) : null,
    rentPaise: t.rentPaise, depositPaise: t.depositPaise, dueDay: t.dueDay, graceDays: t.graceDays, noticeDays: t.noticeDays, gstRateBps: t.gstRateBps, lateFeePaise: t.lateFeePaise,
    deposit: { status: depositStatus as 'NONE' | 'DUE' | 'RECEIVED', receivedAt: t.depositReceivedAt?.toISOString() ?? null, method: t.depositMethod, reference: t.depositReference },
    depositWarning: viewer === 'TENANT' ? null : depositWarning(t.depositPaise, t.rentPaise),
    emergencyContact: t.emergencyContactName && t.emergencyContactPhone ? { name: t.emergencyContactName, phone: t.emergencyContactPhone } : null,
    activatedAt: t.activatedAt?.toISOString() ?? null, cancelledAt: t.cancelledAt?.toISOString() ?? null, cancelReason: t.cancelReason, applicationId: t.applicationId,
    notice: t.noticeGivenAt && t.noticeBy ? { givenAt: t.noticeGivenAt.toISOString(), by: t.noticeBy as 'TENANT' | 'OWNER', reason: t.noticeReason, moveOutDate: t.endDate ? toDateString(t.endDate) : null } : null,
    movedOutAt: t.movedOutAt?.toISOString() ?? null,
    settlement: t.settlement && !(viewer === 'TENANT' && t.settlement.status === 'DRAFT') ? { id: t.settlement.id, status: t.settlement.status, refundPaise: t.settlement.refundPaise } : null,
    version: t.version, createdAt: t.createdAt.toISOString(), actions,
  };
}
