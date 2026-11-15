// Owner dashboards under steady load: the activity log, the occupancy and dues reports, the rent list and the tenant list.
// Run against a PRODUCTION build with the seeded database (`pnpm db:seed`). The API limits each signed-in user to 600 reads a minute,
// so the load is spread over the three seeded owners (about 6 requests a second each) rather than hammering one account.
//   k6 run loadtest/owner-reads.js        (BASE_URL=http://localhost:4000/api/v1 by default)
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:4000/api/v1';
const PASSWORD = __ENV.DEV_PASSWORD || 'Password@123';
const audit = new Trend('audit_ms', true);
const occupancy = new Trend('occupancy_ms', true);
const dues = new Trend('dues_ms', true);
const lists = new Trend('lists_ms', true);
const bad = new Rate('unexpected_status');
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }));

export const options = {
  scenarios: { owners: { executor: 'constant-vus', vus: 3, duration: '30s' } },
  thresholds: { unexpected_status: ['rate<0.01'], audit_ms: ['p(95)<500'], occupancy_ms: ['p(95)<400'], dues_ms: ['p(95)<400'], lists_ms: ['p(95)<400'], http_req_failed: ['rate<0.01'] },
};

export function setup() {
  return [1, 2, 3].map((n) => {
    const res = http.post(`${BASE}/auth/login`, JSON.stringify({ email: `owner${n}@hostel.dev`, password: PASSWORD }), { headers: { 'content-type': 'application/json', 'X-Forwarded-For': `10.9.${n}.1` } });
    const token = res.json('data.accessToken');
    if (!token) throw new Error(`could not sign in owner${n}: ${res.status} (seed the database first)`);
    return token;
  });
}

export default function (tokens) {
  const token = tokens[(__VU - 1) % tokens.length];
  const headers = { authorization: `Bearer ${token}`, 'X-Forwarded-For': `10.9.${__VU}.${(__ITER % 250) + 1}` };
  const get = (path, trend) => {
    const r = http.get(`${BASE}${path}`, { headers });
    trend.add(r.timings.duration);
    bad.add(r.status < 200 || r.status > 299);
    check(r, { [`${path} ok`]: (x) => x.status === 200 });
  };
  get('/owner/audit-logs?limit=50', audit);
  get('/owner/audit-logs?limit=50&action=tenancy.', audit);
  get('/owner/reports/occupancy', occupancy);
  get('/owner/reports/dues', dues);
  get('/owner/rent-invoices?limit=20', lists);
  get('/owner/tenancies?limit=20', lists);
  sleep(1); // six requests then a second of think time: about 6 a second per owner, under the 600-a-minute ceiling
}
