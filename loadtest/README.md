# Load tests (k6)

Install: `brew install k6`. Run against a **production build**, not `next dev`:

```bash
cd backend && pnpm build && TRUST_PROXY=true pnpm start      # API on :4000 (worker: pnpm worker)
k6 run loadtest/browse.js                                    # realistic ramp, thresholds enforced
STRESS=1 k6 run loadtest/browse.js                           # 150 VUs flat out, no think time
k6 run loadtest/booking-race.js                              # overbooking race over HTTP (seeded DB)
```

`TRUST_PROXY=true` matters: each virtual user sends its own `X-Forwarded-For`, as real clients behind a proxy would, so the per-IP rate
limits behave realistically instead of throttling the whole test as one client.

## Results (MacBook, single Node process, local Postgres + Redis, 2026-11-10)

| Scenario | Result |
|---|---|
| `browse.js` ramp to 60 VUs, ~190 req/s | 15,400 checks, 0 failures. p95: search 4 ms, property 4 ms, availability 6 ms, quote 7 ms |
| `STRESS=1`, 150 VUs flat out | ~1,530 req/s sustained, p95: search 21 ms, property 78 ms, availability 135 ms, quote 236 ms. No 5xx; 0.5% client-side connection resets |
| `booking-race.js`, 5 users x 8 simultaneous attempts on a room with 3 free units | exactly 3 holds, 37 `SOLD_OUT`, availability 0, no 5xx, replay with a new key refused |

The stress resets are the macOS listen backlog (`kern.ipc.somaxconn` is 128) refusing a burst of 150 simultaneous connections; the server
logged no errors. On Linux with a proxy in front this does not appear.

## Notes

- `booking-race.js` cancels everything it books. Booking creation is limited to 10 per user per minute, so run it once a minute: a
  second run inside the window shows `RATE_LIMITED` instead of `SOLD_OUT` (the limiter working, not the race). The vitest suite has the
  same invariant at larger scale (40 guests racing for 4 beds, `tests/bookings/booking-create.test.ts`).
- Thresholds in `browse.js` are the API performance budget: p95 search < 600 ms, property < 400 ms, availability < 600 ms,
  quote < 800 ms, error rate < 1%. A quote answered 409/422 (a room that cannot host that stay) is a valid answer, not a failure.
- Web budgets: `pnpm perf:budget` (after `pnpm build` in `frontend/`) fails if any JS chunk exceeds 120 KB gzip or all chunks exceed
  900 KB (currently 707 KB total, largest 70 KB). Lighthouse, production build, 2026-11-10: home 100/100/100/100; search 81/100/100/100;
  property 81/100/100/91 (performance / accessibility / best practices / SEO). The remaining LCP (~5 s) is Lighthouse's simulated slow-4G
  and 4x CPU score on the JS chain; the LCP element itself loads in ~0.4 s here.
