// Pulls the API contract from the backend (the ONLY thing the website shares with it) into ./openapi.
// Usage: pnpm gen:api   (backend must be running; API_URL defaults to http://localhost:4000)
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.API_URL ?? 'http://localhost:4000';
const res = await fetch(`${base}/api/v1/openapi.json`);
if (!res.ok) throw new Error(`Could not fetch the OpenAPI spec from ${base}: HTTP ${res.status}`);
const spec = await res.json();
await mkdir('openapi', { recursive: true });
await writeFile('openapi/openapi.json', JSON.stringify(spec, null, 2) + '\n');
console.log(`openapi/openapi.json: ${Object.keys(spec.paths).length} paths`);
