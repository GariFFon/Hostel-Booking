/**
 * Central API debug logger. ONE place that logs every API call the website makes, in the same shape everywhere:
 *   request  -> id, time, method, base URL, endpoint, full URL, headers, query, full JSON body
 *   response -> id, time, status + text, headers, full body, duration, size
 *   failure  -> the real backend error body, or the network/timeout/abort exception
 * Each response is tied to its request by an id that is also sent as `x-request-id`, so the same id shows up in the BFF and
 * backend logs for that call (the BFF forwards it and the backend adopts it), even when many calls run at once.
 *
 * Development only. In production and in tests nothing is logged and nothing is added to requests.
 * Secrets (passwords, tokens, cookies, api keys, signatures) are masked; everything else is logged whole, never truncated.
 * Works in the browser and on the Next.js server (no `server-only` import on purpose).
 */

export type ApiLogSource = "BROWSER" | "BFF→API" | "SSR→API";

export const API_DEBUG = process.env.NODE_ENV === "development";

const MASK = "[MASKED]";
const SENSITIVE =
  /(password|passwd|pwd|secret|token|authorization|api[-_]?key|apikey|cookie|credential|signature|cvv|^otp$)/i;

const isBrowser = typeof window !== "undefined";
const ANSI = { reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m", green: "\x1b[32m", red: "\x1b[31m", cyan: "\x1b[36m", yellow: "\x1b[33m" };
const CSS = {
  req: "background:#1d4ed8;color:#fff;padding:1px 6px;border-radius:3px;font-weight:600",
  ok: "background:#15803d;color:#fff;padding:1px 6px;border-radius:3px;font-weight:600",
  fail: "background:#b91c1c;color:#fff;padding:1px 6px;border-radius:3px;font-weight:600",
};

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

/** Deep-copies a value with every sensitive field masked. */
export function maskDeep(value: unknown, depth = 0): unknown {
  if (depth > 20 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE.test(k) ? MASK : maskDeep(v, depth + 1);
  return out;
}

function maskHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => { out[k] = SENSITIVE.test(k) ? MASK : v; });
  return out;
}

const pretty = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));
const bytes = (s: string) => (typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : s.length);

/** Parses a text body as JSON (masked and pretty-printed) when it is JSON, otherwise returns it as-is. */
function renderBody(text: string, contentType: string | null): unknown {
  if (!text) return "(empty)";
  if ((contentType ?? "").includes("json") || /^[\s]*[{[]/.test(text)) {
    try { return maskDeep(JSON.parse(text)); } catch { /* not JSON: fall through */ }
  }
  return text;
}

function describeFormData(fd: FormData) {
  const out: Record<string, unknown> = {};
  fd.forEach((v, k) => {
    const shown = typeof v === "string" ? (SENSITIVE.test(k) ? MASK : v) : `[File ${v.name} · ${v.type || "unknown type"} · ${v.size} bytes]`;
    if (k in out) out[k] = ([] as unknown[]).concat(out[k], shown); else out[k] = shown;
  });
  return out;
}

function print(kind: "req" | "ok" | "fail", title: string, lines: [string, unknown][]) {
  const rule = "━".repeat(72);
  const body = lines.map(([k, v]) => `${k}:\n${pretty(v)}`).join("\n");
  if (isBrowser) {
    console.groupCollapsed(`%c${title}`, CSS[kind]);
    console.log(body);
    console.groupEnd();
    return;
  }
  const color = kind === "req" ? ANSI.cyan : kind === "ok" ? ANSI.green : ANSI.red;
  console.log(`${color}${ANSI.bold}${rule}\n${title}\n${rule}${ANSI.reset}\n${body}\n${ANSI.dim}${rule}${ANSI.reset}`);
}

interface Parts { method: string; url: URL; headers: Headers; bodyText: string | null; bodyNote: string | null }

async function readRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Parts> {
  const isReq = typeof Request !== "undefined" && input instanceof Request;
  const base = typeof location !== "undefined" ? location.origin : "http://localhost";
  const url = new URL(isReq ? input.url : String(input), base);
  const method = (init?.method ?? (isReq ? input.method : "GET")).toUpperCase();
  const headers = new Headers(init?.headers ?? (isReq ? input.headers : undefined));
  let bodyText: string | null = null;
  let bodyNote: string | null = null;
  const b = init?.body;
  if (typeof b === "string") bodyText = b;
  else if (typeof FormData !== "undefined" && b instanceof FormData) bodyNote = pretty(describeFormData(b));
  else if (typeof URLSearchParams !== "undefined" && b instanceof URLSearchParams) bodyText = b.toString();
  else if (b == null && isReq && method !== "GET" && method !== "HEAD") {
    if ((headers.get("content-type") ?? "").includes("multipart/")) bodyNote = "[multipart/form-data body: not read]";
    else { try { bodyText = await input.clone().text(); } catch { bodyNote = "[body could not be read]"; } }
  } else if (b != null) bodyNote = `[${Object.prototype.toString.call(b)} body]`;
  return { method, url, headers, bodyText, bodyNote };
}

function errorDetail(e: unknown) {
  const err = e as { name?: string; message?: string; cause?: unknown; stack?: string };
  const kind =
    err?.name === "TimeoutError" ? "TIMEOUT" : err?.name === "AbortError" ? "ABORTED" : err instanceof TypeError ? "NETWORK FAILURE" : "EXCEPTION";
  return { kind, name: err?.name, message: err?.message, cause: err?.cause ? String(err.cause) : undefined, stack: err?.stack };
}

/**
 * Wraps a fetch implementation with the standard log. Pass the result wherever a `fetch` is accepted
 * (openapi-fetch's `fetch` option, or call it directly). Behaviour is otherwise identical to the wrapped fetch.
 */
export function withApiLog(impl: typeof fetch, source: ApiLogSource): typeof fetch {
  return async (input, init) => {
    if (!API_DEBUG) return impl(input, init);

    const id = newId();
    const started = performance.now();
    const startedAt = new Date().toISOString();
    let parts: Parts;
    try {
      parts = await readRequest(input, init);
    } catch {
      return impl(input, init); // logging must never be the reason a request fails
    }

    // One id, carried end to end. Never overrides an id the caller already set.
    let sentId = parts.headers.get("x-request-id");
    if (!sentId) {
      sentId = id;
      if (typeof Request !== "undefined" && input instanceof Request) input.headers.set("x-request-id", id);
      else init = { ...init, headers: (() => { const h = new Headers(init?.headers); h.set("x-request-id", id); return h; })() };
      parts.headers.set("x-request-id", id);
    }

    const query: Record<string, unknown> = {};
    parts.url.searchParams.forEach((v, k) => { query[k] = SENSITIVE.test(k) ? MASK : v; });
    const endpoint = parts.url.pathname;
    const baseUrl = parts.url.origin;

    print("req", `[API ▶ REQUEST · ${source}] ${parts.method} ${endpoint}  #${sentId}`, [
      ["Request ID", sentId],
      ["Started at", startedAt],
      ["Method", parts.method],
      ["Base URL", baseUrl],
      ["Endpoint", endpoint],
      ["Full URL", parts.url.toString()],
      ["Headers", maskHeaders(parts.headers)],
      ["Query params", Object.keys(query).length ? query : "(none)"],
      ["Body", parts.bodyNote ?? (parts.bodyText !== null ? renderBody(parts.bodyText, parts.headers.get("content-type")) : "(none)")],
    ]);

    let res: Response;
    try {
      res = await impl(input, init);
    } catch (e) {
      const ms = Math.round(performance.now() - started);
      const d = errorDetail(e);
      print("fail", `[API ✖ ${d.kind} · ${source}] ${parts.method} ${endpoint}  #${sentId}  ${ms}ms`, [
        ["Request ID", sentId],
        ["Failed at", new Date().toISOString()],
        ["Full URL", parts.url.toString()],
        ["Duration", `${ms} ms`],
        ["Error", d],
      ]);
      throw e;
    }

    const ms = Math.round(performance.now() - started);
    // Read a copy so the caller still gets an untouched, unread response.
    void res.clone().text().then(
      (text) => {
        const okay = res.ok;
        const size = res.headers.get("content-length") ?? String(bytes(text));
        print(okay ? "ok" : "fail", `[API ${okay ? "✔ SUCCESS" : "✖ FAILED"} ${res.status} ${res.statusText} · ${source}] ${parts.method} ${endpoint}  #${sentId}  ${ms}ms`, [
          ["Request ID", sentId],
          ["Responded at", new Date().toISOString()],
          ["Status", `${res.status} ${res.statusText}`.trim()],
          ["Duration", `${ms} ms`],
          ["Size", `${size} bytes`],
          ["Headers", maskHeaders(res.headers)],
          [okay ? "Body" : "Error body (from backend)", renderBody(text, res.headers.get("content-type"))],
        ]);
      },
      () => undefined,
    );
    return res;
  };
}

/**
 * For transports that are not fetch (the direct-to-Cloudinary XHR upload). Call `start`, then `end` or `fail`.
 */
export function logExternalCall(source: ApiLogSource, method: string, url: string, requestBody: unknown) {
  if (!API_DEBUG) return { id: "", end: () => undefined, fail: () => undefined };
  const id = newId();
  const started = performance.now();
  const u = new URL(url, typeof location !== "undefined" ? location.origin : "http://localhost");
  print("req", `[API ▶ REQUEST · ${source}] ${method} ${u.pathname}  #${id}`, [
    ["Request ID", id], ["Started at", new Date().toISOString()], ["Method", method], ["Base URL", u.origin], ["Endpoint", u.pathname],
    ["Full URL", u.toString()], ["Body", maskDeep(requestBody)],
  ]);
  return {
    id,
    end: (status: number, statusText: string, responseText: string) => {
      const ms = Math.round(performance.now() - started);
      const okay = status >= 200 && status < 300;
      print(okay ? "ok" : "fail", `[API ${okay ? "✔ SUCCESS" : "✖ FAILED"} ${status} ${statusText} · ${source}] ${method} ${u.pathname}  #${id}  ${ms}ms`, [
        ["Request ID", id], ["Responded at", new Date().toISOString()], ["Status", `${status} ${statusText}`.trim()],
        ["Duration", `${ms} ms`], ["Size", `${bytes(responseText)} bytes`], [okay ? "Body" : "Error body (from server)", renderBody(responseText, null)],
      ]);
    },
    fail: (kind: "NETWORK FAILURE" | "ABORTED", message: string) => {
      const ms = Math.round(performance.now() - started);
      print("fail", `[API ✖ ${kind} · ${source}] ${method} ${u.pathname}  #${id}  ${ms}ms`, [
        ["Request ID", id], ["Failed at", new Date().toISOString()], ["Duration", `${ms} ms`], ["Error", message],
      ]);
    },
  };
}
