import type { Prisma } from '@/generated/prisma/client';
import { MAX_PHOTOS_PER_COMPLAINT, MAX_REOPENS, REOPEN_WINDOW_DAYS, isSlaBreached } from './complaints.rules';


const person = { select: { id: true, email: true, profile: { select: { fullName: true, phone: true } } } } as const;

export const complaintInclude = {
  hostel: { select: { id: true, name: true, city: true, ownerId: true, owner: { select: { email: true } } } },
  tenancy: { select: { id: true, unit: { select: { label: true } } } },
  raisedBy: person,
  assigned: { select: { id: true, email: true, profile: { select: { fullName: true } }, staffProfile: { select: { trade: true } } } },
  media: { orderBy: { createdAt: 'asc' } },
  comments: { orderBy: { createdAt: 'asc' } },
  history: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ComplaintInclude;

export type ComplaintFull = Prisma.ComplaintGetPayload<{ include: typeof complaintInclude }>;
export type Viewer = 'TENANT' | 'OWNER' | 'STAFF' | 'ADMIN';

type Action = 'comment' | 'add_photo' | 'close' | 'reopen' | 'rate' | 'acknowledge' | 'assign' | 'unassign' | 'reject' | 'resolve' | 'set_priority' | 'start' | 'hold' | 'schedule' | 'set_availability';

/** What this viewer can do right now, so a client never has to guess the rules. */
export function actionsFor(c: ComplaintFull, viewer: Viewer, now = new Date()): Action[] {
  const a: Action[] = [];
  const done = c.status === 'CLOSED' || c.status === 'REJECTED';
  if (viewer !== 'ADMIN' && !done) a.push('comment');
  if (viewer !== 'ADMIN' && !done && c.media.length < MAX_PHOTOS_PER_COMPLAINT) a.push('add_photo');
  if (viewer === 'TENANT') {
    if (!done) a.push('close');
    const inWindow = c.resolvedAt && now.getTime() - c.resolvedAt.getTime() <= REOPEN_WINDOW_DAYS * 86_400_000;
    if (c.status === 'RESOLVED' && inWindow && c.reopenCount < MAX_REOPENS) a.push('reopen');
    if (!done && c.status !== 'RESOLVED') a.push('set_availability');
    if ((c.status === 'RESOLVED' || (c.status === 'CLOSED' && c.resolvedAt)) && c.rating === null) a.push('rate');
  }
  if (viewer === 'OWNER' && !done) {
    if (c.status === 'OPEN') a.push('acknowledge');
    if (c.status !== 'RESOLVED') a.push('assign');
    if (['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'].includes(c.status)) a.push('unassign');
    if (['OPEN', 'ACKNOWLEDGED', 'ASSIGNED'].includes(c.status)) a.push('reject');
    if (c.status !== 'RESOLVED') a.push('resolve');
    if (c.status !== 'RESOLVED') a.push('set_priority');
    if (['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'].includes(c.status)) a.push('schedule');
  }
  if (viewer === 'STAFF' && !done) {
    if (['ASSIGNED', 'REOPENED', 'ON_HOLD'].includes(c.status)) a.push('start');
    if (['ASSIGNED', 'IN_PROGRESS', 'REOPENED'].includes(c.status)) a.push('hold');
    if (['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'].includes(c.status)) a.push('resolve', 'schedule');
  }
  return a;
}

const name = (p: { fullName: string } | null | undefined) => p?.fullName ?? null;

export function toComplaintSummary(c: ComplaintFull, viewer: Viewer, now = new Date()) {
  const staffView = viewer === 'STAFF';
  return {
    id: c.id, code: c.code, status: c.status, category: c.category, priority: c.priority, title: c.title, location: c.location,
    hostel: { id: c.hostel.id, name: c.hostel.name, city: c.hostel.city },
    unitLabel: c.tenancy.unit.label,
    // Staff need a name to ask for, not the tenant's contact details; the owner and admin see them.
    raisedBy: { id: c.raisedBy.id, name: name(c.raisedBy.profile), phone: staffView ? null : (c.raisedBy.profile?.phone ?? null), email: staffView || viewer === 'TENANT' ? null : c.raisedBy.email },
    assignedStaff: c.assigned ? { id: c.assigned.id, name: name(c.assigned.profile), trade: c.assigned.staffProfile?.trade ?? null } : null,
    slaDueAt: c.slaDueAt.toISOString(), slaBreached: isSlaBreached(c, now),
    availability: c.availableFrom && c.availableTo ? { from: c.availableFrom.toISOString(), to: c.availableTo.toISOString(), allowEntryIfAway: c.allowEntryIfAway } : null,
    visit: c.visitStart && c.visitEnd ? { start: c.visitStart.toISOString(), end: c.visitEnd.toISOString() } : null,
    mediaCount: c.media.length, commentCount: c.comments.filter((x) => viewer !== 'TENANT' || !x.internal).length,
    rating: c.rating, reopenCount: c.reopenCount, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
  };
}

export function toComplaintDetail(c: ComplaintFull, viewer: Viewer, now = new Date()) {
  return {
    ...toComplaintSummary(c, viewer, now),
    description: c.description,
    acknowledgedAt: c.acknowledgedAt?.toISOString() ?? null, resolvedAt: c.resolvedAt?.toISOString() ?? null, resolutionNote: c.resolutionNote, closedAt: c.closedAt?.toISOString() ?? null, feedback: c.feedback,
    media: c.media.map((m) => ({ id: m.id, url: m.url, uploadedByRole: m.uploaderRole, createdAt: m.createdAt.toISOString() })),
    // Internal notes are for the owner, staff and admin: the tenant never sees them.
    comments: c.comments.filter((x) => viewer !== 'TENANT' || !x.internal).map((x) => ({ id: x.id, authorName: x.authorName, authorRole: x.authorRole, body: x.body, internal: x.internal, createdAt: x.createdAt.toISOString() })),
    history: c.history.map((h) => ({ id: h.id, fromStatus: h.fromStatus, toStatus: h.toStatus, actorRole: h.actorRole, note: viewer === 'TENANT' && h.actorRole === 'OWNER' && h.toStatus === 'ASSIGNED' ? null : h.note, createdAt: h.createdAt.toISOString() })),
    viewer, version: c.version, actions: actionsFor(c, viewer, now),
  };
}
