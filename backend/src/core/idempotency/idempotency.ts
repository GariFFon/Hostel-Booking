import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/infra/db/prisma';
import { AppError, Errors } from '../errors/app-error';

const KEY_RE = /^[A-Za-z0-9_:.-]{8,80}$/;
const STALE_LOCK_MS = 60_000;
const RETENTION_MS = 24 * 3600_000;

/** Reads and validates the `Idempotency-Key` header. */
export function idempotencyKeyFrom(req: NextRequest, { required }: { required: boolean }): string | null {
  const key = req.headers.get('idempotency-key');
  if (!key) {
    if (required) throw Errors.validation([{ path: 'Idempotency-Key', message: 'This request needs an Idempotency-Key header (8-80 chars: letters, digits, _ : . -). Generate one per user action and reuse it on retries.' }]);
    return null;
  }
  if (!KEY_RE.test(key)) throw Errors.validation([{ path: 'Idempotency-Key', message: 'Idempotency-Key must be 8-80 characters: letters, digits, _ : . -' }]);
  return key;
}

const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v ?? null);

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/**
 * Runs `run` at most once per (user, key). A retry with the same key and body gets the stored response; the same
 * key with a different body is a client bug (409). A concurrent duplicate is told to retry. Failures release the
 * key, so a corrected retry is allowed to run.
 */
export async function withIdempotency<T>(
  scope: { userId: string; key: string; method: string; path: string; body: unknown },
  run: () => Promise<{ status: number; body: T }>,
  depth = 0,
): Promise<IdempotentResult<T>> {
  const requestHash = createHash('sha256').update(`${scope.method} ${scope.path} ${canonical(scope.body)}`).digest('hex');
  let rowId: string;
  try {
    rowId = (await prisma.idempotencyKey.create({
      data: { userId: scope.userId, key: scope.key, method: scope.method, path: scope.path, requestHash, expiresAt: new Date(Date.now() + RETENTION_MS) },
    })).id;
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    const existing = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId: scope.userId, key: scope.key } } });
    if (!existing) {
      if (depth >= 3) throw new AppError('IDEMPOTENCY_CONFLICT', 'Could not reserve this Idempotency-Key. Retry in a moment.', { inProgress: true });
      return withIdempotency(scope, run, depth + 1); // it was just released; try again
    }
    if (existing.requestHash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used with a different request');
    if (existing.completedAt) return { status: existing.responseStatus ?? 200, body: existing.responseBody as T, replayed: true };
    // Still running elsewhere, or its owner crashed: take the lock over only if it is stale.
    const taken = await prisma.idempotencyKey.updateMany({ where: { id: existing.id, completedAt: null, lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } }, data: { lockedAt: new Date() } });
    if (taken.count === 0) throw new AppError('IDEMPOTENCY_CONFLICT', 'A request with this Idempotency-Key is still being processed. Retry in a moment.', { inProgress: true });
    rowId = existing.id;
  }

  let result: { status: number; body: T };
  try {
    result = await run();
  } catch (e) {
    // The handler itself failed: nothing was committed, so release the key and let a corrected retry run.
    await prisma.idempotencyKey.delete({ where: { id: rowId } }).catch(() => undefined);
    throw e;
  }
  // The handler SUCCEEDED (its side effects are committed). Recording the response must not release the key, or a retry would run
  // the handler a second time: retry the bookkeeping, and if it still fails leave the key locked (a retry then gets "in progress").
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.idempotencyKey.update({ where: { id: rowId }, data: { responseStatus: result.status, responseBody: result.body as Prisma.InputJsonValue, completedAt: new Date() } });
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 50 * attempt));
    }
  }
  return { ...result, replayed: false };
}
