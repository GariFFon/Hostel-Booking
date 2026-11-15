import { describe, expect, it } from 'vitest';
import type { ComplaintStatus } from '@/generated/prisma/client';
import { SLA_RUNNING, TERMINAL, TRANSITIONS, UNRESOLVED, WITH_STAFF, canTransition, type ComplaintActor } from '@/modules/complaints/complaints.status';
import { MAX_REOPENS, REOPEN_WINDOW_DAYS, SLA_HOURS, TRADE_FOR_CATEGORY, isSlaBreached, newComplaintCode, slaDueAt } from '@/modules/complaints/complaints.rules';

const ACTORS: ComplaintActor[] = ['TENANT', 'OWNER', 'STAFF', 'ADMIN', 'SYSTEM'];
const STATUSES = Object.keys(TRANSITIONS) as ComplaintStatus[];

describe('the complaint state machine', () => {
  it('the happy path: open, assigned, in progress, resolved, closed', () => {
    expect(canTransition('OPEN', 'ASSIGNED', 'SYSTEM')).toBe(true); // auto-assignment
    expect(canTransition('ASSIGNED', 'IN_PROGRESS', 'STAFF')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'RESOLVED', 'STAFF')).toBe(true);
    expect(canTransition('RESOLVED', 'CLOSED', 'TENANT')).toBe(true);
    expect(canTransition('RESOLVED', 'CLOSED', 'SYSTEM')).toBe(true); // auto-close
  });

  it('only the tenant reopens, and only a resolved complaint', () => {
    expect(canTransition('RESOLVED', 'REOPENED', 'TENANT')).toBe(true);
    for (const a of ACTORS.filter((x) => x !== 'TENANT')) expect(canTransition('RESOLVED', 'REOPENED', a)).toBe(false);
    for (const from of STATUSES.filter((s) => s !== 'RESOLVED')) expect(canTransition(from, 'REOPENED', 'TENANT')).toBe(false);
  });

  it('staff work a job but cannot reject, assign or acknowledge it, and the tenant cannot do the work', () => {
    for (const to of ['REJECTED', 'ACKNOWLEDGED', 'ASSIGNED'] as ComplaintStatus[]) for (const from of STATUSES) expect(canTransition(from, to, 'STAFF'), `${from}->${to}`).toBe(false);
    for (const to of ['IN_PROGRESS', 'ON_HOLD', 'RESOLVED'] as ComplaintStatus[]) for (const from of STATUSES) expect(canTransition(from, to, 'TENANT'), `${from}->${to}`).toBe(false);
  });

  it('an owner can re-assign a complaint that is already assigned, but nobody else can', () => {
    expect(canTransition('ASSIGNED', 'ASSIGNED', 'OWNER')).toBe(true);
    expect(canTransition('ASSIGNED', 'ASSIGNED', 'STAFF')).toBe(false);
    expect(canTransition('OPEN', 'OPEN', 'OWNER')).toBe(false);
  });

  it('a tenant may withdraw until it is resolved, never after', () => {
    for (const from of ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'] as ComplaintStatus[]) expect(canTransition(from, 'CLOSED', 'TENANT'), from).toBe(true);
    expect(canTransition('REJECTED', 'CLOSED', 'TENANT')).toBe(false);
  });

  it('closed and rejected are final', () => {
    for (const s of TERMINAL) {
      expect(Object.keys(TRANSITIONS[s])).toEqual([]);
      for (const to of STATUSES) for (const a of ACTORS) expect(canTransition(s, to, a)).toBe(false);
    }
  });

  it('every move listed is to a real status by a real actor, and the status groups agree with the table', () => {
    for (const [from, moves] of Object.entries(TRANSITIONS)) for (const [to, actors] of Object.entries(moves)) {
      expect(STATUSES, `${from}->${to}`).toContain(to);
      expect(actors!.length, `${from}->${to}`).toBeGreaterThan(0);
    }
    expect(WITH_STAFF.every((s) => UNRESOLVED.includes(s))).toBe(true);
    expect(SLA_RUNNING.every((s) => UNRESOLVED.includes(s))).toBe(true);
    expect(SLA_RUNNING).not.toContain('ON_HOLD'); // waiting on purpose stops the clock
    expect(UNRESOLVED).not.toContain('RESOLVED');
  });
});

describe('SLA and limits', () => {
  it('urgent is 4 hours, high a day, medium three days, low a week', () => {
    expect(SLA_HOURS).toEqual({ URGENT: 4, HIGH: 24, MEDIUM: 72, LOW: 168 });
    const t = new Date('2027-03-01T10:00:00Z');
    expect(slaDueAt(t, 'URGENT').toISOString()).toBe('2027-03-01T14:00:00.000Z');
    expect(slaDueAt(t, 'LOW').toISOString()).toBe('2027-03-08T10:00:00.000Z');
  });

  it('is only breached while someone still has to act', () => {
    const past = new Date('2027-03-01T00:00:00Z');
    const now = new Date('2027-03-02T00:00:00Z');
    for (const status of ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'REOPENED']) expect(isSlaBreached({ status, slaDueAt: past }, now), status).toBe(true);
    for (const status of ['ON_HOLD', 'RESOLVED', 'CLOSED', 'REJECTED']) expect(isSlaBreached({ status, slaDueAt: past }, now), status).toBe(false);
    expect(isSlaBreached({ status: 'OPEN', slaDueAt: now }, now)).toBe(false); // exactly on time is not late
  });

  it('maps every category to the right trade, and OTHER to nobody', () => {
    expect(TRADE_FOR_CATEGORY).toMatchObject({ ELECTRICAL: 'ELECTRICIAN', PLUMBING: 'PLUMBER', CLEANING: 'CLEANER', WIFI: 'NETWORK', OTHER: null });
  });

  it('codes read as CMP-XXXXXX and do not repeat; reopening is bounded', () => {
    expect(newComplaintCode()).toMatch(/^CMP-[A-HJ-NP-Z2-9]{6}$/);
    expect(new Set(Array.from({ length: 200 }, newComplaintCode)).size).toBe(200);
    expect(MAX_REOPENS).toBeGreaterThan(0);
    expect(REOPEN_WINDOW_DAYS).toBe(7);
  });
});
