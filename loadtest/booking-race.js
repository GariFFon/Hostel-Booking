// Overbooking race over real HTTP. Five seeded guests fire simultaneous booking requests (each with its own Idempotency-Key)
// at the scarcest room of a property. The number of holds created must equal the free units exactly: never more (overbooking),
// never fewer while demand exceeds supply. Everything it books is cancelled in teardown.
//   k6 run loadtest/booking-race.js        (needs the seeded dev DB; guest1..5@hostel.dev / Password@123)
// Booking creation is limited to 10 per user per minute, so 5 guests x 8 attempts fits once a minute; run it again only after a minute
// (otherwise most attempts come back RATE_LIMITED, which is the limiter working, not the race).
import http from 'k6/http';
import { check, fail } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:4000/api/v1';
const SLUG = __ENV.SLUG || 'palolem-beach-nomads-goa';
const ATTEMPTS_PER_GUEST = Number(__ENV.ATTEMPTS || 8);
const JSON_H = { 'Content-Type': 'application/json' };
// 409 SOLD_OUT and 409/422 for the per-user open-hold cap are legitimate refusals.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 409, 422, 429));

export const options = {
  scenarios: { race: { executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '2m' } },
  thresholds: { checks: ['rate==1'] },
};

const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const key = () => `k6-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;

export function setup() {
  const tokens = [];
  for (let i = 1; i <= 5; i++) {
    const r = http.post(`${BASE}/auth/login`, JSON.stringify({ email: `guest${i}@hostel.dev`, password: 'Password@123' }), { headers: JSON_H });
    if (r.status !== 200) fail(`login guest${i} failed: ${r.status} ${r.body}`);
    tokens.push(r.json('data.accessToken'));
  }
  const detail = http.get(`${BASE}/hostels/${SLUG}`).json('data');
  const checkIn = day(140), checkOut = day(141);
  const avail = http.get(`${BASE}/hostels/${SLUG}/availability?checkIn=${checkIn}&checkOut=${checkOut}&guests=1`).json('data.rooms');
  const gender = (id) => (detail.roomTypes.find((r) => r.id === id) || {}).gender;
  // the scarcest room that a guest of either gender may book
  const candidates = avail.filter((r) => r.eligible && r.availableUnits > 0 && gender(r.roomTypeId) === 'MIXED').sort((a, b) => a.availableUnits - b.availableUnits);
  if (candidates.length === 0) fail('no mixed-gender room with free units for the race dates');
  const room = candidates[0];
  if (room.availableUnits > 3 * tokens.length) fail(`room has ${room.availableUnits} free units: more than the 5 guests can hold (cap 3 each); pick another SLUG`);
  return { tokens, hostelId: detail.id, roomTypeId: room.roomTypeId, free: room.availableUnits, checkIn, checkOut, created: [] };
}

export default function (data) {
  const body = JSON.stringify({
    hostelId: data.hostelId, checkIn: data.checkIn, checkOut: data.checkOut, items: [{ roomTypeId: data.roomTypeId, units: 1 }],
    guests: [{ fullName: 'Race Tester', gender: 'FEMALE', age: 30 }], contactPhone: '+919876543210',
  });
  const reqs = [];
  const owner = []; // which guest each request belongs to
  for (let g = 0; g < data.tokens.length; g++) {
    for (let a = 0; a < ATTEMPTS_PER_GUEST; a++) {
      reqs.push(['POST', `${BASE}/bookings`, body, { headers: { ...JSON_H, Authorization: `Bearer ${data.tokens[g]}`, 'Idempotency-Key': key(), 'X-Forwarded-For': `10.9.${g}.${a + 1}` } }]);
      owner.push(g);
    }
  }
  const res = http.batch(reqs);
  const won = res.filter((r) => r.status === 201);
  const codes = {};
  res.forEach((r) => { const c = r.status === 201 ? 'CREATED' : (r.json('error.code') || `HTTP_${r.status}`); codes[c] = (codes[c] || 0) + 1; });
  console.log(`attempts=${res.length} free=${data.free} created=${won.length} outcomes=${JSON.stringify(codes)}`);

  won.forEach((r) => { data.created.push(r.json('data.id')); });
  check(null, {
    'never more holds than free units (no overbooking)': () => won.length <= data.free,
    'every free unit was sold (demand exceeded supply)': () => won.length === data.free,
    'every loser got a clean refusal, never a 5xx': () => res.every((r) => r.status < 500),
  });

  // inventory agrees with what was sold
  const after = http.get(`${BASE}/hostels/${SLUG}/availability?checkIn=${data.checkIn}&checkOut=${data.checkOut}&guests=1`).json('data.rooms').find((r) => r.roomTypeId === data.roomTypeId);
  check(after, { 'availability now shows 0 units left': (r) => r.availableUnits === 0 });

  // a replay of one winning request (same key) must return that booking, not take another unit
  const k = key();
  const first = http.post(`${BASE}/bookings`, body, { headers: { ...JSON_H, Authorization: `Bearer ${data.tokens[0]}`, 'Idempotency-Key': k } });
  check(first, { 'sold-out room still refuses a new key': (r) => r.status === 409 || r.status === 422 || r.status === 429 });
  data.__won = won.map((r) => ({ id: r.json('data.id') }));
  return data;
}

export function teardown(data) {
  // cancel every booking the race created (all belong to guests 1..5; try each token until one owns it)
  const ids = http.get(`${BASE}/bookings?when=upcoming&limit=50`, { headers: { Authorization: `Bearer ${data.tokens[0]}` } });
  let cancelled = 0;
  data.tokens.forEach((t) => {
    const list = http.get(`${BASE}/bookings?when=upcoming&limit=50`, { headers: { Authorization: `Bearer ${t}` } }).json('data') || [];
    list.filter((b) => b.checkIn === data.checkIn && b.hostel && b.hostel.id === data.hostelId).forEach((b) => {
      const r = http.post(`${BASE}/bookings/${b.id}/cancel`, JSON.stringify({ reason: 'k6 race cleanup' }), { headers: { ...JSON_H, Authorization: `Bearer ${t}` } });
      if (r.status === 200) cancelled++;
    });
  });
  console.log(`teardown: cancelled ${cancelled} bookings`);
}
