import { describe, expect, it } from 'vitest';
import { prisma } from '@/infra/db/prisma';
import { POST as quote } from '@/app/api/v1/quotes/route';
import { PATCH as patchHostel } from '@/app/api/v1/owner/hostels/[id]/route';
import { call } from '../helpers/http';
import { STAY, book, bookingBody, makeGuest, makeHost } from '../helpers/booking';
import { hostelPayload, makeHostel, makeRoom } from '../helpers/listings';
import { makeUser } from '../helpers/users';

const quoteBody = (hostelId: string, roomTypeId: string) => ({ hostelId, ...STAY, guests: 1, items: [{ roomTypeId, units: 1 }] });

describe('nightly booking only exists for hotels', () => {
  it('quotes a hotel', async () => {
    const { hostel, rooms } = await makeHost({ propertyType: 'HOTEL' });
    const res = await call(quote, { body: quoteBody(hostel.id, rooms[0]!.id) });
    expect(res.status).toBe(200);
  });

  for (const propertyType of ['HOSTEL', 'PG'] as const) {
    it(`refuses a nightly quote and booking on a ${propertyType}`, async () => {
      const { hostel, rooms } = await makeHost({ propertyType, rooms: [{ priceUnit: 'MONTH', price: 600000 }] });
      const res = await call(quote, { body: quoteBody(hostel.id, rooms[0]!.id) });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/rented monthly/i);

      const guest = await makeGuest();
      const booked = await book(guest.token, bookingBody(hostel.id, rooms[0]!.id));
      expect(booked.status).toBe(409);
    });
  }
});

describe('rooms follow the stay mode', () => {
  it('hostels and PGs are priced monthly, hotels nightly', async () => {
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'], kyc: 'APPROVED' });
    const hotel = await makeHostel(owner.token, { propertyType: 'HOTEL' });
    const hostel = await makeHostel(owner.token, { propertyType: 'HOSTEL', name: 'Campus Hostel' });
    const unitOf = async (id: string) => (await prisma.roomType.findUniqueOrThrow({ where: { id } })).priceUnit;
    expect(await unitOf((await makeRoom(owner.token, hotel.id)).id)).toBe('NIGHT');
    expect(await unitOf((await makeRoom(owner.token, hostel.id, { basePricePaise: 700000 })).id)).toBe('MONTH');
  });
});

describe('a property cannot change its stay mode once it has rooms', () => {
  const change = (token: string, id: string, propertyType: string) => call(patchHostel, { method: 'PATCH', token, params: { id }, body: { propertyType } });

  it('allows HOSTEL <-> PG at any time (both long-term)', async () => {
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'], kyc: 'APPROVED' });
    const h = await makeHostel(owner.token, { propertyType: 'HOSTEL' });
    await makeRoom(owner.token, h.id, { basePricePaise: 700000 });
    expect((await change(owner.token, h.id, 'PG')).status).toBe(200);
  });

  it('allows any change while the listing is still empty', async () => {
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'], kyc: 'APPROVED' });
    const h = await makeHostel(owner.token, { propertyType: 'HOSTEL' });
    expect((await change(owner.token, h.id, 'HOTEL')).status).toBe(200);
  });

  it('refuses nightly <-> long-term once a room exists', async () => {
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'], kyc: 'APPROVED' });
    const h = await makeHostel(owner.token, hostelPayload({ propertyType: 'HOTEL' }));
    await makeRoom(owner.token, h.id);
    const res = await change(owner.token, h.id, 'HOSTEL');
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/cannot switch/i);
  });
});
