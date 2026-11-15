import { describe, expect, it } from 'vitest';
import { GET as me } from '@/app/api/v1/me/route';
import { GET as ownerHostels } from '@/app/api/v1/owner/hostels/route';
import { GET as ownerEarnings } from '@/app/api/v1/owner/earnings/route';
import { GET as adminBookings } from '@/app/api/v1/admin/bookings/route';
import { GET as adminAudit } from '@/app/api/v1/admin/audit-logs/route';
import { GET as listUnits } from '@/app/api/v1/owner/room-types/[id]/units/route';
import { call } from '../helpers/http';
import { makeUser } from '../helpers/users';

/** STAFF is a real role from phase 10, but on its own it grants nothing: access comes from assignments (phase 13). */
describe('the STAFF role', () => {
  it('can sign in and sees its role on /me', async () => {
    const staff = await makeUser({ roles: ['STAFF'] });
    const res = await call(me, { method: 'GET', token: staff.token });
    expect(res.status).toBe(200);
    expect(res.body.data.roles).toEqual(['STAFF']);
  });

  it('is refused on every owner and admin endpoint', async () => {
    const staff = await makeUser({ roles: ['STAFF'] });
    for (const [name, handler, params] of [
      ['owner hostels', ownerHostels, {}], ['owner earnings', ownerEarnings, {}], ['admin bookings', adminBookings, {}], ['admin audit', adminAudit, {}],
      ['owner units', listUnits, { id: '019d0000-0000-7000-8000-000000000000' }],
    ] as const) {
      const res = await call(handler, { method: 'GET', token: staff.token, params });
      expect(res.status, name).toBe(403);
    }
  });

  it('cannot be granted through registration', async () => {
    const { POST: register } = await import('@/app/api/v1/auth/register/route');
    const res = await call(register, { body: { email: `s${Date.now()}@test.dev`, password: 'Sup3r-secret-pass', fullName: 'Sneaky Staff', role: 'STAFF' } });
    expect(res.status).toBe(422);
  });
});
