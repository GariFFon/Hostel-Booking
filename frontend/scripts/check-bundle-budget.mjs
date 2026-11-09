// Fails when the production build's JavaScript outgrows its budget. Run after `pnpm build`:  pnpm perf:budget
// Budgets are gzip sizes: no single chunk above 120 KB, and all chunks together under 900 KB (currently ~705 KB, largest ~70 KB).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const SINGLE_KB = 120;
const TOTAL_KB = 900;

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
  });
}

const files = walk(".next/static/chunks").map((f) => ({ f, kb: gzipSync(readFileSync(f), { level: 6 }).length / 1024 }));
const total = files.reduce((a, x) => a + x.kb, 0);
const biggest = files.sort((a, b) => b.kb - a.kb)[0];
console.log(`JS (gzip): total ${total.toFixed(0)} KB (budget ${TOTAL_KB}), largest chunk ${biggest.kb.toFixed(0)} KB (budget ${SINGLE_KB}): ${biggest.f}`);
if (total > TOTAL_KB || biggest.kb > SINGLE_KB) {
  console.error("Bundle budget exceeded.");
  process.exit(1);
}
