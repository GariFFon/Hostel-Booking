import type { NextResponse } from 'next/server';
import type { Actor } from '../context/request-context';
import type { RouteContext } from '../http/wrap';
import { ok } from '../http/response';
import { idempotencyKeyFrom, withIdempotency } from './idempotency';

/**
 * Runs a mutating handler under idempotency when the client sent a key (mandatory when `required`). Replays are marked with
 * `Idempotent-Replayed: true`. Without a key the handler simply runs (it must then be naturally safe to repeat).
 */
export async function respondIdempotent<T>(
  ctx: RouteContext, actor: Actor, opts: { required: boolean; body: unknown; status?: number }, run: (key: string | null) => Promise<T>,
): Promise<NextResponse> {
  const key = idempotencyKeyFrom(ctx.req, { required: opts.required });
  const meta = { requestId: ctx.requestId };
  const status = opts.status ?? 200;
  if (!key) return ok(await run(null), meta, status);
  const r = await withIdempotency({ userId: actor.id, key, method: ctx.req.method, path: ctx.req.nextUrl.pathname, body: opts.body }, async () => ({ status, body: await run(key) }));
  return ok(r.body, meta, r.status, r.replayed ? { 'Idempotent-Replayed': 'true' } : undefined);
}
