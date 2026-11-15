import { STATUS_CODES } from 'node:http';

/**
 * Central API debug logger for the backend (the server side of every call). `wrap()` calls it once per request, so every
 * route is covered and no handler logs on its own. Same shape as the website and Flutter loggers:
 *   request  -> id, time, method, base URL, endpoint, full URL, headers, query, full JSON body
 *   response -> id, time, status + text, headers, full body, duration, size
 * The id is the `x-request-id` the client sent (website and Flutter send one), so a single call can be followed from the
 * client console through the BFF to here.
 *
 * Development only (NODE_ENV=development and API_DEBUG_LOG not "false"). Production and tests log nothing extra: the existing
 * one-line pino request log is untouched. Secrets are masked; nothing else is truncated.
 */

const MASK = '[MASKED]';
const SENSITIVE = /(password|passwd|pwd|secret|token|authorization|api[-_]?key|apikey|cookie|credential|signature|cvv|^otp$)/i;
const RULE = '━'.repeat(72);
const C = { reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m' };

export const apiDebugEnabled = () => process.env.NODE_ENV === 'development' && process.env.API_DEBUG_LOG !== 'false';

export function maskDeep(value: unknown, depth = 0): unknown {
  if (depth > 20 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE.test(k) ? MASK : maskDeep(v, depth + 1);
  return out;
}

const maskHeaders = (h: Headers) => {
  const out: Record<string, string> = {};
  h.forEach((v, k) => { out[k] = SENSITIVE.test(k) ? MASK : v; });
  return out;
};

function renderBody(text: string, contentType: string | null): string {
  if (!text) return '(empty)';
  if ((contentType ?? '').includes('json') || /^\s*[{[]/.test(text)) {
    try { return JSON.stringify(maskDeep(JSON.parse(text)), null, 2); } catch { /* not JSON */ }
  }
  return text;
}

function block(kind: 'req' | 'ok' | 'fail', title: string, sections: [string, unknown][]) {
  const color = kind === 'req' ? C.cyan : kind === 'ok' ? C.green : C.red;
  const body = sections.map(([k, v]) => `${k}:\n${typeof v === 'string' ? v : JSON.stringify(v, null, 2)}`).join('\n');
  process.stdout.write(`${color}${C.bold}${RULE}\n${title}\n${RULE}${C.reset}\n${body}\n${C.dim}${RULE}${C.reset}\n`);
}

/** Reads the request body for the log without consuming the one the handler will read. */
export async function readRequestForLog(req: Request): Promise<string> {
  const type = req.headers.get('content-type') ?? '';
  if (['GET', 'HEAD'].includes(req.method)) return '(none)';
  if (type.includes('multipart/')) return '[multipart/form-data body: not read]';
  try { return renderBody(await req.clone().text(), type); } catch { return '[body could not be read]'; }
}

export function logApiRequest(a: { id: string; req: Request; url: URL; body: string }) {
  const query: Record<string, string> = {};
  a.url.searchParams.forEach((v, k) => { query[k] = SENSITIVE.test(k) ? MASK : v; });
  block('req', `[API ▶ REQUEST · API IN] ${a.req.method} ${a.url.pathname}  #${a.id}`, [
    ['Request ID', a.id],
    ['Received at', new Date().toISOString()],
    ['Method', a.req.method],
    ['Base URL', a.url.origin],
    ['Endpoint', a.url.pathname],
    ['Full URL', a.url.toString()],
    ['Headers', maskHeaders(a.req.headers)],
    ['Query params', Object.keys(query).length ? query : '(none)'],
    ['Body', a.body],
  ]);
}

export async function logApiResponse(a: { id: string; req: Request; url: URL; res: Response; ms: number }) {
  let text = '';
  try { text = await a.res.clone().text(); } catch { text = '[body could not be read]'; }
  const ok = a.res.status >= 200 && a.res.status < 300;
  const statusText = a.res.statusText || STATUS_CODES[a.res.status] || '';
  block(ok ? 'ok' : 'fail', `[API ${ok ? '✔ SUCCESS' : '✖ FAILED'} ${a.res.status} ${statusText} · API OUT] ${a.req.method} ${a.url.pathname}  #${a.id}  ${a.ms}ms`, [
    ['Request ID', a.id],
    ['Responded at', new Date().toISOString()],
    ['Status', `${a.res.status} ${statusText}`.trim()],
    ['Duration', `${a.ms} ms`],
    ['Size', `${a.res.headers.get('content-length') ?? Buffer.byteLength(text)} bytes`],
    ['Headers', maskHeaders(a.res.headers)],
    [ok ? 'Body' : 'Error body', renderBody(text, a.res.headers.get('content-type'))],
  ]);
}

/** An exception that escaped the handler (the 500 path): the actual error and stack, not just "Something went wrong". */
export function logApiException(a: { id: string; req: Request; url: URL; error: unknown; ms: number }) {
  const e = a.error as { name?: string; message?: string; stack?: string; code?: string };
  block('fail', `[API ✖ EXCEPTION · API IN] ${a.req.method} ${a.url.pathname}  #${a.id}  ${a.ms}ms`, [
    ['Request ID', a.id],
    ['Failed at', new Date().toISOString()],
    ['Error', { name: e?.name, code: e?.code, message: e?.message, stack: e?.stack }],
  ]);
}
