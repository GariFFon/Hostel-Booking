import { NextRequest } from 'next/server';

type RouteFn = (req: NextRequest, seg: { params: Promise<Record<string, string>> }) => Promise<Response>;

let ipCounter = 10;
/** Each call gets a fresh client IP by default so rate-limit buckets don't leak between tests. */
export const freshIp = () => `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

export async function call<T = any>(
  handler: unknown,
  opts: { method?: string; body?: unknown; rawBody?: string; token?: string; ip?: string; headers?: Record<string, string>; params?: Record<string, string>; query?: string } = {},
): Promise<{ status: number; body: T; headers: Headers }> {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': opts.ip ?? freshIp(), ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const req = new NextRequest(`http://localhost:4000/api/v1/test${opts.query ?? ''}`, {
    method: opts.method ?? 'POST',
    headers,
    body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const res = await (handler as RouteFn)(req, { params: Promise.resolve(opts.params ?? {}) });
  return { status: res.status, body: (await res.json()) as T, headers: res.headers };
}
