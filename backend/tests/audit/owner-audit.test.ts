import { describe, expect, it } from 'vitest';
import { prisma } from '@/infra/db/prisma';
import { makeUser } from '../helpers/users';
import { makeStay } from '../helpers/tenancy';
import { activeTenant } from '../helpers/rent';
import { mo, tenantWithDeposit } from '../helpers/moveout';
import { api } from '../helpers/tenancy';
import { publish } from '../helpers/publish';

const items = (r: { body: { data: unknown } }) => r.body.data as { id: string; at: string; action: string; entityType: string; entityId: string | null; outcome: string; actor: { id: string | null; name: string | null; role: string | null }; hostel: { id: string; name: string } | null; before: unknown; after: unknown; metadata: Record<string, unknown> | null }[];

describe('an owner\'s audit trail', () => {
  it('shows what happened at their own properties and nothing from anyone else\'s', async () => {
    const a = await tenantWithDeposit();
    const b = await tenantWithDeposit();
    const mine = items(await mo.audit(a.stay.owner.token, '?limit=100'));
    expect(mine.length).toBeGreaterThan(3);
    for (const row of mine) {
      expect(row.hostel).toEqual({ id: a.stay.hostel.id, name: a.stay.hostel.name });
      expect(JSON.stringify(row)).not.toContain(b.stay.hostel.id);
    }
    expect(mine.map((r) => r.action)).toEqual(expect.arrayContaining(['tenancy.create', 'tenancy.deposit.record', 'tenancy.activate']));
    const theirs = items(await mo.audit(b.stay.owner.token, '?limit=100'));
    expect(theirs.map((r) => r.id)).not.toEqual(expect.arrayContaining(mine.map((r) => r.id).slice(0, 1)));
    for (const row of theirs) expect(row.hostel?.id).toBe(b.stay.hostel.id);
  });

  it('names who did it, shows the system for automatic changes, and leaves out network and device details', async () => {
    const { stay, tenant, tenancyId } = await tenantWithDeposit();
    await mo.notice(tenant.token, tenancyId, { moveOutDate: new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10) });
    const rows = items(await mo.audit(stay.owner.token, '?action=tenancy.notice&limit=20'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'tenancy.notice.give', actor: { id: tenant.id, name: 'Test Person' }, outcome: 'SUCCESS', after: { by: 'TENANT' } });
    expect(Object.keys(rows[0]!).sort()).toEqual(['action', 'actor', 'after', 'at', 'before', 'entityId', 'entityType', 'hostel', 'id', 'metadata', 'outcome']);
    for (const key of ['ip', 'userAgent', 'hash', 'prevHash', 'requestId']) expect(JSON.stringify(rows[0])).not.toContain(`"${key}"`);
    await prisma.auditLog.create({ data: { action: 'tenancy.sweep.demo', entityType: 'tenancy', entityId: tenancyId, actorId: null, actorRole: 'SYSTEM', metadata: { hostelId: stay.hostel.id } } });
    expect(items(await mo.audit(stay.owner.token, '?action=tenancy.sweep'))[0]!.actor).toEqual({ id: null, name: null, role: 'SYSTEM' });
  });

  it('includes changes to the property record itself', async () => {
    const stay = await makeStay();
    await prisma.auditLog.create({ data: { action: 'hostel.update', entityType: 'hostel', entityId: stay.hostel.id, actorId: stay.owner.id, actorRole: 'OWNER', after: { name: 'New name' } } }); // no metadata.hostelId on this kind of row
    const rows = items(await mo.audit(stay.owner.token, '?action=hostel.'));
    expect(rows.map((r) => r.action)).toContain('hostel.update');
    expect(rows.find((r) => r.action === 'hostel.update')!.hostel?.id).toBe(stay.hostel.id);
  });

  it('can be filtered by property, action, entity, outcome and time, and a property that is not theirs looks missing', async () => {
    const stay1 = await makeStay();
    const owner = stay1.owner;
    const pg2 = await publish({ propertyType: 'PG', ownerId: owner.id });
    for (const [h, n] of [[stay1.hostel.id, 3], [pg2.hostel.id, 2]] as const) for (let i = 0; i < n; i++) await prisma.auditLog.create({ data: { action: `unit.test${i}`, entityType: 'unit', entityId: `u${i}`, actorId: owner.id, actorRole: 'OWNER', outcome: i === 0 ? 'FAILURE' : 'SUCCESS', metadata: { hostelId: h } } });
    expect(items(await mo.audit(owner.token, `?hostelId=${pg2.hostel.id}&action=unit.`))).toHaveLength(2);
    expect(items(await mo.audit(owner.token, `?hostelId=${stay1.hostel.id}&action=unit.`))).toHaveLength(3);
    expect(items(await mo.audit(owner.token, '?action=unit.test1'))).toHaveLength(2);
    expect(items(await mo.audit(owner.token, '?action=unit.&outcome=FAILURE'))).toHaveLength(2);
    expect(items(await mo.audit(owner.token, '?action=unit.&entityType=unit'))).toHaveLength(5);
    expect(items(await mo.audit(owner.token, '?action=unit.&entityType=booking'))).toHaveLength(0);
    expect(items(await mo.audit(owner.token, `?action=unit.&from=${new Date(Date.now() + 86_400_000).toISOString()}`))).toHaveLength(0);
    expect(items(await mo.audit(owner.token, `?action=unit.&to=${new Date(Date.now() + 86_400_000).toISOString()}`))).toHaveLength(5);
    const rival = await makeStay();
    expect((await mo.audit(owner.token, `?hostelId=${rival.hostel.id}`)).status).toBe(404);
    expect((await mo.audit(owner.token, '?hostelId=not-a-uuid')).status).toBe(422);
    expect((await mo.audit(owner.token, '?limit=1000')).status).toBe(422);
  });

  it('treats the action filter as a plain prefix, never a pattern or SQL', async () => {
    const stay = await makeStay();
    await prisma.auditLog.create({ data: { action: 'unit.alpha', entityType: 'unit', actorId: stay.owner.id, actorRole: 'OWNER', metadata: { hostelId: stay.hostel.id } } });
    for (const q of ['%', '_', 'unit.%', "'; DROP TABLE audit_logs; --", 'u_it.']) expect(items(await mo.audit(stay.owner.token, `?action=${encodeURIComponent(q)}`))).toHaveLength(0);
    expect(items(await mo.audit(stay.owner.token, '?action=unit.'))).toHaveLength(1);
    expect(await prisma.auditLog.count()).toBeGreaterThan(0);
  });

  it('pages newest first without gaps or repeats', async () => {
    const stay = await makeStay();
    for (let i = 0; i < 7; i++) await prisma.auditLog.create({ data: { action: `page.row${i}`, entityType: 'unit', actorId: stay.owner.id, actorRole: 'OWNER', metadata: { hostelId: stay.hostel.id } } });
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const res = await mo.audit(stay.owner.token, `?action=page.&limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...items(res).map((r) => r.action));
      cursor = (res.body as unknown as { meta: { nextCursor: string | null } }).meta.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(['page.row6', 'page.row5', 'page.row4', 'page.row3', 'page.row2', 'page.row1', 'page.row0']);
  });

  it('is for owners only', async () => {
    const t = await activeTenant();
    const admin = await makeUser({ roles: ['ADMIN'] });
    for (const who of [t.tenant, admin, await makeUser()]) expect((await mo.audit(who.token)).status).toBe(403);
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'], kyc: 'APPROVED' }); // an owner with no properties yet
    expect(items(await mo.audit(owner.token))).toEqual([]);
    void api;
  });
});
