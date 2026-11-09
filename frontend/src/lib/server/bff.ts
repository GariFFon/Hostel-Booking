import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "./config";
import { backend, readEnvelope, type BackendInit, type Tokens } from "./backend";
import { clearSessionCookies, setSessionCookies } from "./cookies";
import { refreshSession } from "./refresh";

/**
 * Backend-for-frontend: the ONLY way the browser reaches the API.
 *  - tokens live in httpOnly cookies; JavaScript (and therefore XSS) can never read them
 *  - requests are forwarded with the access token attached; an expired token is refreshed transparently (single-flight)
 *  - state-changing requests must come from our own origin (CSRF)
 *  - only an allow-listed shape of path is forwarded, and server-to-server routes are blocked
 */
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9/_\-.]*$/;
const BLOCKED = [/^auth\/refresh$/, /^payments\/webhooks\//, /(^|\/)\.\.(\/|$)/];
const PASS_REQUEST_HEADERS = ["accept-language", "idempotency-key", "x-request-id"];
const PASS_RESPONSE_HEADERS = ["x-cache", "idempotent-replayed", "retry-after", "x-request-id", "content-language"];

/** Responses that carry a fresh session: store it in cookies, never hand tokens to the page. */
const SESSION_ISSUING = new Set(["auth/login", "auth/register", "auth/google", "me/password"]);

const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
const err = (status: number, code: string, message: string) => json(status, { error: { code, message, details: null, requestId: "bff" } });

function sameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const origin = req.headers.get("origin");
  if (origin) return origin === req.nextUrl.origin;
  return req.headers.get("sec-fetch-site") === "same-origin"; // some non-browser clients omit Origin; browsers never do on POST
}

function clientHeaders(req: NextRequest): Record<string, string> {
  const h: Record<string, string> = {};
  for (const k of PASS_REQUEST_HEADERS) { const v = req.headers.get(k); if (v) h[k] = v; }
  // The backend rate-limits per client IP: hand it the real one (the backend must run with TRUST_PROXY=true behind us).
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd) h["x-forwarded-for"] = fwd;
  const ua = req.headers.get("user-agent");
  if (ua) h["user-agent"] = ua.slice(0, 300);
  return h;
}

interface Outcome { res: Response; refreshed: Tokens | null; sessionLost: boolean }

/** Calls the backend as the cookie's user, refreshing the access token first (or after a 401) when needed. */
async function authed(req: NextRequest, path: string, init: BackendInit): Promise<Outcome> {
  let at = req.cookies.get(ACCESS_COOKIE)?.value ?? null;
  const rt = req.cookies.get(REFRESH_COOKIE)?.value ?? null;
  let refreshed: Tokens | null = null;
  let sessionLost = false;

  const refresh = async () => {
    if (!rt) return;
    refreshed = await refreshSession(rt);
    if (refreshed) at = refreshed.accessToken;
    else { at = null; sessionLost = true; }
  };

  if (!at && rt) await refresh();
  let res = await backend(path, { ...init, token: at });
  if (res.status === 401 && at && rt && !refreshed) {
    await refresh();
    if (refreshed) res = await backend(path, { ...init, token: at });
  }
  return { res, refreshed, sessionLost };
}

function finish(res: Response, bodyOverride: unknown | undefined, o: { refreshed?: Tokens | null; sessionLost?: boolean; session?: Tokens | null; clear?: boolean }) {
  const out = bodyOverride !== undefined
    ? NextResponse.json(bodyOverride, { status: res.status })
    : new NextResponse(res.status === 204 ? null : res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
  for (const h of PASS_RESPONSE_HEADERS) { const v = res.headers.get(h); if (v) out.headers.set(h, v); }
  out.headers.set("cache-control", "no-store");
  const session = o.session ?? o.refreshed;
  if (o.clear || o.sessionLost) clearSessionCookies(out);
  else if (session) setSessionCookies(out, session);
  return out;
}

export async function handleBff(req: NextRequest, segments: string[]): Promise<NextResponse> {
  const path = segments.join("/");
  if (!path || path.length > 300 || !SAFE_PATH.test(path) || BLOCKED.some((r) => r.test(path))) return err(404, "NOT_FOUND", "Not found");
  if (!sameOrigin(req)) return err(403, "FORBIDDEN", "Cross-site requests are not allowed");

  const search = req.nextUrl.search;
  const method = req.method;
  const rt = req.cookies.get(REFRESH_COOKIE)?.value ?? null;

  try {
    // ── sign out: needs the refresh token from the cookie; always ends with cookies cleared ──
    if (path === "auth/logout") {
      if (rt) await backend("auth/logout", { method: "POST", contentType: "application/json", body: JSON.stringify({ refreshToken: rt }) }).catch(() => null);
      return finish(new Response(null, { status: 200 }), { data: { loggedOut: true }, meta: { requestId: "bff" } }, { clear: true });
    }

    const raw = method === "GET" || method === "HEAD" ? null : await req.arrayBuffer();
    const init: BackendInit = { method, body: raw && raw.byteLength ? raw : null, contentType: req.headers.get("content-type"), headers: clientHeaders(req) };
    const target = path + search;

    // ── sign in / up / password change: the response carries a session ──
    if (SESSION_ISSUING.has(path)) {
      const { res, refreshed, sessionLost } = path === "me/password" ? await authed(req, target, init) : { res: await backend(target, init), refreshed: null, sessionLost: false };
      if (!res.ok) return finish(res, undefined, { refreshed, sessionLost });
      const env = await readEnvelope<Tokens>(res);
      if (!env.data?.accessToken) return err(502, "INTERNAL", "Unexpected response from the server");
      const { accessToken, refreshToken, expiresIn, user } = env.data;
      return finish(res, { data: { user, expiresIn }, meta: { requestId: res.headers.get("x-request-id") ?? "bff" } }, { session: { accessToken, refreshToken, expiresIn, user } });
    }

    // ── everything else ──
    const { res, refreshed, sessionLost } = await authed(req, target, init);

    if (path === "auth/logout-all") return finish(res, undefined, { clear: res.ok, refreshed, sessionLost });

    // Roles are baked into the access token: after becoming an owner, rotate tokens so the new role takes effect now.
    if (path === "me/become-owner" && res.ok) {
      const current = refreshed?.refreshToken ?? rt;
      const next = current ? await refreshSession(current).catch(() => null) : null;
      return finish(res, undefined, { session: next ?? refreshed });
    }

    return finish(res, undefined, { refreshed, sessionLost });
  } catch (e) {
    const timeout = e instanceof DOMException && e.name === "TimeoutError";
    return err(timeout ? 504 : 503, "DEPENDENCY_UNAVAILABLE", "The service is temporarily unavailable. Please try again.");
  }
}
