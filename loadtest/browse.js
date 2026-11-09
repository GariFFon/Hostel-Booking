// Public browse traffic: search -> property page -> availability -> quote. Run against a PRODUCTION build (`pnpm build && TRUST_PROXY=true pnpm start`),
// not `next dev`. Each virtual user presents its own client IP via X-Forwarded-For, as real traffic behind a proxy would,
// so per-IP rate limits behave realistically.
//   k6 run loadtest/browse.js            (BASE_URL=http://localhost:4000/api/v1 by default)
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:4000/api/v1';
// 422 / 409 are legitimate answers to a quote (a room that cannot host this stay): not failures. Anything 5xx still is.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 409, 422));
const searchMs = new Trend('search_ms', true);
const detailMs = new Trend('detail_ms', true);
const availMs = new Trend('availability_ms', true);
const quoteMs = new Trend('quote_ms', true);
const bad = new Rate('unexpected_status');

// STRESS=1: no think time, 150 VUs flat out, to find where latency bends. Otherwise a realistic ramp.
const STRESS = __ENV.STRESS === '1';
export const options = {
  scenarios: STRESS ? { stress: { executor: 'constant-vus', vus: 150, duration: '30s' } } : {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 25 },
        { duration: '40s', target: 60 },
        { duration: '20s', target: 0 },
      ],
    },
  },
  thresholds: {
    unexpected_status: ['rate<0.01'],
    search_ms: ['p(95)<600'],
    detail_ms: ['p(95)<400'],
    availability_ms: ['p(95)<600'],
    quote_ms: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
  },
};

const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

export function setup() {
  const res = http.get(`${BASE}/hostels?limit=20`);
  const list = res.json('data');
  if (!list || list.length === 0) throw new Error('no hostels: seed the database first');
  const hostels = list.map((h) => ({ slug: h.slug, id: h.id }));
  const rooms = {};
  for (const h of hostels) {
    rooms[h.slug] = (http.get(`${BASE}/hostels/${h.slug}`).json('data.roomTypes') || []).map((r) => r.id);
  }
  return { hostels, rooms };
}

export default function (data) {
  const h = data.hostels[Math.floor(Math.random() * data.hostels.length)];
  const headers = { 'X-Forwarded-For': `10.${__VU % 250}.${__ITER % 250}.${(__VU * 7 + __ITER) % 250 + 1}` };
  const checkIn = day(30 + Math.floor(Math.random() * 60));
  const checkOut = day(32 + Math.floor(Math.random() * 60) - 0);
  const ok = (r, name) => { const pass = check(r, { [`${name} 2xx`]: (x) => x.status >= 200 && x.status < 300 }); bad.add(!pass); };

  let r = http.get(`${BASE}/hostels?limit=20&sort=recommended`, { headers });
  searchMs.add(r.timings.duration); ok(r, 'search');

  r = http.get(`${BASE}/hostels/${h.slug}`, { headers });
  detailMs.add(r.timings.duration); ok(r, 'detail');

  const ci = day(40), co = day(42);
  r = http.get(`${BASE}/hostels/${h.slug}/availability?checkIn=${ci}&checkOut=${co}&guests=1`, { headers });
  availMs.add(r.timings.duration); ok(r, 'availability');

  const room = (data.rooms[h.slug] || [])[0];
  if (room) {
    r = http.post(`${BASE}/quotes`, JSON.stringify({ hostelId: h.id, checkIn: ci, checkOut: co, guests: 1, items: [{ roomTypeId: room, units: 1 }] }), { headers: { ...headers, 'Content-Type': 'application/json' } });
    quoteMs.add(r.timings.duration);
    // 200 normally; 422 is a legitimate answer for a room that cannot host this stay (min nights, gender).
    const pass = check(r, { 'quote answered': (x) => x.status === 200 || x.status === 422 || x.status === 409 });
    bad.add(!pass);
  }
  if (!STRESS) sleep(0.3 + Math.random() * 0.7);
}
