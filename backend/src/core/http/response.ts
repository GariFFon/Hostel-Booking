import { NextResponse } from 'next/server';
import { AppError } from '../errors/app-error';

export interface ResponseMeta {
  requestId: string;
  nextCursor?: string | null;
  total?: number;
}

export function ok<T>(data: T, meta: ResponseMeta, status = 200, headers?: HeadersInit) {
  return NextResponse.json({ data, meta }, { status, headers });
}

export function fail(err: AppError, requestId: string) {
  const headers: Record<string, string> = {};
  if (err.code === 'RATE_LIMITED') {
    const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
    if (retry) headers['Retry-After'] = String(retry);
  }
  return NextResponse.json(
    { error: { code: err.code, message: err.message, details: err.details ?? null, requestId } },
    { status: err.status, headers },
  );
}
