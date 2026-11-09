import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

export const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().nullable(), requestId: z.string() }),
});

registry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });

const envelope = <T extends z.ZodType>(data: T) => z.object({ data, meta: z.object({ requestId: z.string(), nextCursor: z.string().nullable().optional(), total: z.number().optional() }) });

interface RouteDoc {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string; // OpenAPI style, e.g. /hostels/{id}
  summary: string;
  tags: string[];
  auth?: boolean;
  body?: z.ZodType;
  query?: z.ZodObject;
  response: z.ZodType;
  status?: number;
  errors?: number[];
}

/** Modules call this next to their schemas so the spec cannot drift from validation. */
/** Every `{name}` in the path becomes a declared path parameter (required by OpenAPI, and what typed clients need). */
function pathParams(path: string) {
  const names = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
  if (names.length === 0) return undefined;
  return z.object(Object.fromEntries(names.map((n) => [n, n === 'id' || n.endsWith('Id') ? z.uuid() : z.string().min(1).max(100)])));
}

export function documentRoute(r: RouteDoc) {
  const errs = Object.fromEntries(
    [...new Set([...(r.errors ?? []), ...(r.body ? [422] : []), ...(r.auth ? [401] : []), 429, 500])].map((s) => [
      s,
      { description: `Error ${s}`, content: { 'application/json': { schema: errorSchema } } },
    ]),
  );
  registry.registerPath({
    method: r.method,
    path: r.path,
    summary: r.summary,
    tags: r.tags,
    security: r.auth ? [{ bearerAuth: [] }] : undefined,
    request: {
      params: pathParams(r.path),
      body: r.body ? { content: { 'application/json': { schema: r.body } }, required: true } : undefined,
      query: r.query,
    },
    responses: {
      [r.status ?? 200]: { description: 'Success', content: { 'application/json': { schema: envelope(r.response) } } },
      ...errs,
    },
  });
}

export function buildOpenApiDocument() {
  // Importing module doc files registers their routes.
  return import('@/modules/openapi-docs').then(() =>
    new OpenApiGeneratorV31(registry.definitions).generateDocument({
      openapi: '3.1.0',
      info: { title: 'Hostel Booking API', version: '1.0.0', description: 'REST API shared by the website and the Flutter app. All responses use the {data, meta} / {error} envelope.' },
      servers: [{ url: '/api/v1' }],
    }),
  );
}
