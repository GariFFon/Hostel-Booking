import type { NextRequest } from 'next/server';
import { z, type ZodType } from 'zod';
import { Errors } from '../errors/app-error';

const MAX_BODY_BYTES = 1_000_000;

export async function parseJson<S extends ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw Errors.validation(null, 'Request body too large');
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) throw new Error('too large');
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw Errors.validation(null, 'Request body must be valid JSON');
  }
  return schema.parse(raw); // ZodError is mapped to the validation envelope by wrap()
}

export function parseQuery<S extends ZodType>(req: NextRequest, schema: S): z.infer<S> {
  const q: Record<string, string | string[]> = {};
  for (const key of new Set(req.nextUrl.searchParams.keys())) {
    const all = req.nextUrl.searchParams.getAll(key);
    q[key] = all.length > 1 ? all : all[0]!;
  }
  return schema.parse(q);
}

import type { RouteContext } from './wrap';

const uuid = z.uuid();
/** Path-param UUID. A malformed id is simply "not found" (never a 500, never an oracle). */
export function idParam(ctx: RouteContext, name = 'id'): string {
  const parsed = uuid.safeParse(ctx.params[name]);
  if (!parsed.success) throw Errors.notFound();
  return parsed.data;
}

/** `[idOrSlug]` path segment: a UUID or a lower-case slug. Anything else is "not found". */
export function slugParam(ctx: RouteContext, name = 'idOrSlug'): string {
  const v = ctx.params[name];
  if (!v || v.length > 100 || !/^[A-Za-z0-9-]+$/.test(v)) throw Errors.notFound();
  return v;
}
