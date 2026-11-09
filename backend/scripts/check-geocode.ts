/* eslint-disable no-console */
// Live check of the geocoding proxy against real OpenStreetMap Nominatim (2 requests, 1.2 s apart, per their usage policy).
// Run: pnpm check:geocode
import { geoService } from '../src/modules/geo/geo.service';
import { redis } from '../src/infra/redis/redis';

async function main() {
  const places = (await geoService.search('Palolem Beach, Goa', 3)).value;
  console.log(`search -> ${places.length} result(s)`);
  for (const p of places) console.log(`  ${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}  city=${p.city} locality=${p.locality} state=${p.state} pin=${p.postalCode} country=${p.country}`);
  const ok = places.length > 0 && places.every((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  console.log(ok ? 'PASS  search returns normalised coordinates' : 'FAIL  search');

  await new Promise((r) => setTimeout(r, 1200));
  const here = (await geoService.reverse(12.9784, 77.6408)).value; // Indiranagar, Bengaluru
  console.log('reverse ->', JSON.stringify(here && { city: here.city, locality: here.locality, state: here.state, pin: here.postalCode, country: here.country }));
  const ok2 = here?.country === 'IN';
  console.log(ok2 ? 'PASS  reverse resolves to India' : 'FAIL  reverse');
  await redis.quit();
  process.exit(ok && ok2 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
