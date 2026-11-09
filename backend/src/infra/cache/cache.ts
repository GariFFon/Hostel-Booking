import { createHash } from 'node:crypto';
import { logger } from '@/core/logger/logger';
import { key, redis } from '@/infra/redis/redis';

/**
 * Read-through cache with O(1), race-free invalidation.
 *
 * Every entry belongs to one or more *namespaces* (e.g. `search`, `hostel:<id>`). A namespace has a version
 * counter in Redis, and the version is part of the data key. Invalidating = INCR the counter: old entries become
 * unreachable instantly (and expire via TTL). A reader that loaded stale data while an invalidation raced it
 * writes under the old version, which nobody reads again.
 *
 * Redis failures never fail a request: the loader just runs (a cache miss).
 */
export interface CacheClient {
  get(k: string): Promise<string | null>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  set(k: string, v: string, mode: 'EX', ttl: number): Promise<unknown>;
  incr(k: string): Promise<number>;
}

let client: () => CacheClient = () => redis as unknown as CacheClient;
/** Test seam. */
export function setCacheClient(c: CacheClient | null) {
  client = c ? () => c : () => redis as unknown as CacheClient;
}

const MAX_ENTRY_BYTES = 512 * 1024;
const inflight = new Map<string, Promise<unknown>>();

export interface CacheOptions {
  /** Invalidation namespaces this entry depends on. */
  ns: string[];
  /** Identity of the query within the namespaces (will be hashed if long). */
  key: string;
  ttlSeconds: number;
}

export interface CacheResult<T> {
  value: T;
  hit: boolean;
}

export const hashKey = (v: unknown) => createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 20);

let lastWarn = 0;
function warnOnce(err: unknown) {
  if (Date.now() - lastWarn > 30_000) {
    lastWarn = Date.now();
    logger.warn({ err: (err as Error).message }, 'cache unavailable, serving from the database');
  }
}

export async function cached<T>(opts: CacheOptions, loader: () => Promise<T>): Promise<CacheResult<T>> {
  const c = client();
  let dataKey: string;
  try {
    const versions = await c.mget(...opts.ns.map((n) => key('cv', n)));
    dataKey = key('c', opts.ns.map((n, i) => `${n}@${versions[i] ?? 0}`).join('+'), opts.key.length > 80 ? hashKey(opts.key) : opts.key);
    const raw = await c.get(dataKey);
    if (raw !== null) return { value: JSON.parse(raw) as T, hit: true };
  } catch (e) {
    warnOnce(e);
    return { value: await loader(), hit: false };
  }

  // Single flight: concurrent misses for the same entry share one load.
  const pending = inflight.get(dataKey);
  if (pending) return { value: (await pending) as T, hit: false };
  const load = (async () => {
    const value = await loader();
    try {
      const raw = JSON.stringify(value);
      if (raw.length <= MAX_ENTRY_BYTES) await c.set(dataKey, raw, 'EX', opts.ttlSeconds + Math.floor(Math.random() * Math.min(30, opts.ttlSeconds * 0.1))); // jitter avoids synchronized expiry
    } catch (e) {
      warnOnce(e);
    }
    return value;
  })().finally(() => inflight.delete(dataKey));
  inflight.set(dataKey, load);
  return { value: await load, hit: false };
}

/** Makes every cached entry in these namespaces unreachable. Call AFTER the database transaction commits. */
export async function invalidate(...namespaces: string[]): Promise<void> {
  try {
    const c = client();
    await Promise.all(namespaces.map((n) => c.incr(key('cv', n))));
  } catch (e) {
    warnOnce(e);
  }
}
