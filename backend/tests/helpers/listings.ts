import { POST as createHostel } from '@/app/api/v1/owner/hostels/route';
import { POST as createRoom } from '@/app/api/v1/owner/hostels/[id]/room-types/route';
import { POST as addMedia } from '@/app/api/v1/owner/hostels/[id]/media/route';
import { POST as signature } from '@/app/api/v1/uploads/signature/route';
import { call } from './http';
import type { FakeStorage } from './fake-storage';

export const hostelPayload = (over: object = {}) => ({
  name: 'Sunset Backpackers', description: 'A friendly hostel close to the beach with a rooftop bar.',
  addressLine1: '12 Beach Road', city: 'Goa', state: 'Goa', postalCode: '403001', latitude: 15.49, longitude: 73.82, ...over,
});

export const roomPayload = (over: object = {}) => ({
  name: '6-bed mixed dorm', kind: 'DORM', totalUnits: 6, basePricePaise: 80000, ...over,
});

/** Signs an upload for the hostel, "uploads" it to the fake, and attaches it. Returns the media DTO. */
export async function attachPhoto(token: string, hostelId: string, storage: FakeStorage, opts: { roomTypeId?: string } = {}) {
  const sig = await call(signature, { token, body: { purpose: opts.roomTypeId ? 'ROOM_IMAGE' : 'HOSTEL_IMAGE', hostelId } });
  const publicId: string = sig.body.data.publicId;
  storage.put(publicId);
  const res = await call(addMedia, { token, params: { id: hostelId }, body: { publicId, roomTypeId: opts.roomTypeId } });
  if (res.status !== 201) throw new Error(`attachPhoto failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export async function makeHostel(token: string, over: object = {}) {
  const res = await call(createHostel, { token, body: hostelPayload(over) });
  if (res.status !== 201) throw new Error(`makeHostel failed: ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; slug: string; version: number };
}

export async function makeRoom(token: string, hostelId: string, over: object = {}) {
  const res = await call(createRoom, { token, params: { id: hostelId }, body: roomPayload(over) });
  if (res.status !== 201) throw new Error(`makeRoom failed: ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; version: number };
}
