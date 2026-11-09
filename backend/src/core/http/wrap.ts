import { randomUUID } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { runWithContext, type RequestContext } from '../context/request-context';
import { AppError, Errors } from '../errors/app-error';
import { logger } from '../logger/logger';
import { fail } from './response';

export interface RouteContext {
  req: NextRequest;
  requestId: string;
  ip: string;
  params: Record<string, string>;
}

type Handler = (ctx: RouteContext) => Promise<NextResponse>;

/** Client IP. Only trust forwarding headers when running behind a proxy you control (TRUST_PROXY=true). */
export function clientIp(req: NextRequest): string {
  if (env().TRUST_PROXY) {
    // A proxy APPENDS the address it saw, so the left-most entries are whatever the client claimed. Count back from the right by
    // the number of proxies we trust (TRUSTED_PROXY_HOPS, default 1) to get the address our own proxy observed.
    const parts = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const seen = parts[Math.max(0, parts.length - env().TRUSTED_PROXY_HOPS)];
    if (seen) return seen;
    const real = req.headers.get('x-real-ip');
    if (real) return real;
  }
  return '127.0.0.1';
}

/**
 * Every route handler goes through wrap(): request id, async request context (for audit attribution),
 * uniform error envelope, structured logs. Routes stay thin: validate -> call service -> return ok().
 */
export function wrap(handler: Handler) {
  return async (req: NextRequest, segment: { params: Promise<Record<string, string>> }) => {
    // A caller may supply an id to correlate logs, but only a plain token: anything else is replaced so log lines stay clean.
    const supplied = req.headers.get('x-request-id');
    const requestId = supplied && /^[A-Za-z0-9._:-]{1,100}$/.test(supplied) ? supplied : randomUUID();
    const ip = clientIp(req);
    const ctx: RequestContext = { requestId, ip, userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? null, actor: null };
    const started = performance.now();

    return runWithContext(ctx, async () => {
      let response: NextResponse;
      try {
        const params = (await segment?.params) ?? {};
        response = await handler({ req, requestId, ip, params });
      } catch (e) {
        const err =
          e instanceof AppError
            ? e
            : e instanceof ZodError
              ? Errors.validation(e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
              : null;
        if (err) {
          response = fail(err, requestId);
        } else {
          logger.error({ err: e, requestId, path: req.nextUrl.pathname }, 'unhandled error');
          response = fail(new AppError('INTERNAL', 'Something went wrong'), requestId);
        }
      }
      response.headers.set('x-request-id', requestId);
      logger.info(
        { requestId, method: req.method, path: req.nextUrl.pathname, status: response.status, actor: ctx.actor?.id, ms: Math.round(performance.now() - started) },
        'request',
      );
      return response;
    });
  };
}

export const clientMeta = (ctx: RouteContext) => ({ ip: ctx.ip, userAgent: ctx.req.headers.get('user-agent')?.slice(0, 300) ?? null });
