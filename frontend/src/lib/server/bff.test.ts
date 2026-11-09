import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const backend = vi.fn();
const refreshSession = vi.fn();
vi.mock("./backend", async (orig) => ({ ...(await orig<typeof import("./backend")>()), backend: (...a: unknown[]) => backend(...a) }));
vi.mock("./refresh", () => ({ refreshSession: (...a: unknown[]) => refreshSession(...a) }));

import { handleBff } from "./bff";

const ORIGIN = "http://localhost:3000";
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(status < 400 ? { data, meta: { requestId: "r" } } : data), { status, headers: { "content-type": "application/json", ...headers } });
const req = (method: string, path: string, init: { cookies?: string; origin?: string | null; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`${ORIGIN}/api/bff/${path}`, {
    method,
    headers: { ...(init.cookies ? { cookie: init.cookies } : {}), ...(init.origin === null ? {} : { origin: init.origin ?? ORIGIN }), "content-type": "application/json", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const seg = (p: string) => p.split("/");
const setCookies = (r: Response) => r.headers.getSetCookie();
const sent = () => backend.mock.calls.map((c) => ({ path: c[0] as string, init: c[1] as { token?: string | null; method?: string; headers?: Record<string, string> } }));

beforeEach(() => { backend.mockReset(); refreshSession.mockReset(); });

describe("what the browser may reach", () => {
  it.each(["auth/refresh", "payments/webhooks/demo", "../admin", "hostels/../../etc/passwd", "a b", "x?y", ""])("blocks %j", async (p) => {
    const res = await handleBff(req("GET", p || "x"), p ? seg(p) : []);
    expect(res.status).toBe(404);
    expect(backend).not.toHaveBeenCalled();
  });
  it("forwards ordinary paths and query strings", async () => {
    backend.mockResolvedValue(json([]));
    const res = await handleBff(new NextRequest(`${ORIGIN}/api/bff/hostels?city=Goa&limit=5`), ["hostels"]);
    expect(res.status).toBe(200);
    expect(sent()[0]!.path).toBe("hostels?city=Goa&limit=5");
  });
});

describe("CSRF: state-changing requests must come from our own origin", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s from another site is refused", async (m) => {
    const res = await handleBff(req(m, "me/wishlist/x", { origin: "https://evil.example", cookies: "hb_at=a; hb_rt=r" }), seg("me/wishlist/x"));
    expect(res.status).toBe(403);
    expect(backend).not.toHaveBeenCalled();
  });
  it("a POST with no Origin and no same-origin fetch metadata is refused", async () => {
    expect((await handleBff(req("POST", "bookings", { origin: null }), ["bookings"])).status).toBe(403);
  });
  it("same-origin POST and any GET pass", async () => {
    backend.mockResolvedValue(json({}));
    expect((await handleBff(req("POST", "bookings", { body: {} }), ["bookings"])).status).toBe(200);
    expect((await handleBff(req("GET", "me", { origin: "https://evil.example" }), ["me"])).status).toBe(200); // reads are not state changes
  });
});

describe("the session lives only in httpOnly cookies", () => {
  it("never forwards a browser-supplied Authorization header; uses the cookie's token", async () => {
    backend.mockResolvedValue(json({}));
    await handleBff(req("GET", "me", { cookies: "hb_at=GOOD", headers: { authorization: "Bearer FORGED" } }), ["me"]);
    expect(sent()[0]!.init.token).toBe("GOOD");
    expect(JSON.stringify(sent()[0]!.init.headers)).not.toContain("FORGED");
  });

  it("login: tokens go into httpOnly cookies and are stripped from the response body", async () => {
    backend.mockResolvedValue(json({ accessToken: "AT", refreshToken: "RT", expiresIn: 900, tokenType: "Bearer", user: { id: "u1", email: "a@b.c" } }));
    const res = await handleBff(req("POST", "auth/login", { body: { email: "a@b.c", password: "x" } }), seg("auth/login"));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/AT|RT|accessToken|refreshToken/);
    expect(body.data.user.id).toBe("u1");
    const cookies = setCookies(res).join("\n");
    expect(cookies).toMatch(/hb_at=AT/);
    expect(cookies).toMatch(/hb_rt=RT/);
    expect(cookies).toMatch(/HttpOnly/i);
    expect(cookies).toMatch(/SameSite=lax/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a failed login sets no cookies and passes the error through", async () => {
    backend.mockResolvedValue(json({ error: { code: "UNAUTHENTICATED", message: "bad" } }, 401));
    const res = await handleBff(req("POST", "auth/login", { body: {} }), seg("auth/login"));
    expect(res.status).toBe(401);
    expect(setCookies(res)).toEqual([]);
  });

  it("logout revokes the refresh token server-side and always clears the cookies", async () => {
    backend.mockResolvedValue(json({ loggedOut: true }));
    const res = await handleBff(req("POST", "auth/logout", { cookies: "hb_at=a; hb_rt=RT" }), seg("auth/logout"));
    expect(res.status).toBe(200);
    expect(sent()[0]!.path).toBe("auth/logout");
    const cookies = setCookies(res).join("\n");
    expect(cookies).toMatch(/hb_at=;/);
    expect(cookies).toMatch(/hb_rt=;/);
    backend.mockRejectedValue(new Error("backend down"));
    expect(setCookies(await handleBff(req("POST", "auth/logout", { cookies: "hb_rt=RT" }), seg("auth/logout"))).join("\n")).toMatch(/hb_rt=;/); // signing out works even if the API is down
  });
});

describe("transparent token refresh", () => {
  it("refreshes BEFORE the call when the access cookie has expired, and sets the new cookies", async () => {
    refreshSession.mockResolvedValue({ accessToken: "AT2", refreshToken: "RT2", expiresIn: 900, user: { id: "u" } });
    backend.mockResolvedValue(json({ id: "u" }));
    const res = await handleBff(req("GET", "me", { cookies: "hb_rt=RT1" }), ["me"]);
    expect(refreshSession).toHaveBeenCalledWith("RT1");
    expect(sent()[0]!.init.token).toBe("AT2");
    expect(setCookies(res).join("\n")).toMatch(/hb_at=AT2/);
  });

  it("retries ONCE with a fresh token when the backend says 401 (e.g. access token revoked)", async () => {
    refreshSession.mockResolvedValue({ accessToken: "AT2", refreshToken: "RT2", expiresIn: 900, user: { id: "u" } });
    backend.mockResolvedValueOnce(json({ error: { code: "UNAUTHENTICATED", message: "x" } }, 401)).mockResolvedValueOnce(json({ ok: true }));
    const res = await handleBff(req("GET", "me/bookings", { cookies: "hb_at=STALE; hb_rt=RT1" }), seg("me/bookings"));
    expect(res.status).toBe(200);
    expect(backend).toHaveBeenCalledTimes(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("a dead refresh token clears the cookies and the call goes out unauthenticated", async () => {
    refreshSession.mockResolvedValue(null);
    backend.mockResolvedValue(json({ error: { code: "UNAUTHENTICATED", message: "x" } }, 401));
    const res = await handleBff(req("GET", "me", { cookies: "hb_rt=DEAD" }), ["me"]);
    expect(sent()[0]!.init.token).toBeNull();
    expect(setCookies(res).join("\n")).toMatch(/hb_rt=;/);
  });

  it("does not retry a request whose body was already consumed incorrectly: the body is sent again intact", async () => {
    refreshSession.mockResolvedValue({ accessToken: "AT2", refreshToken: "RT2", expiresIn: 900, user: { id: "u" } });
    backend.mockResolvedValueOnce(json({ error: { code: "UNAUTHENTICATED", message: "x" } }, 401)).mockResolvedValueOnce(json({ id: "b" }, 201));
    const res = await handleBff(req("POST", "bookings", { cookies: "hb_at=STALE; hb_rt=RT1", body: { hostelId: "h" } }), ["bookings"]);
    expect(res.status).toBe(201);
    const bodies = backend.mock.calls.map((c) => Buffer.from(c[1].body as ArrayBuffer).toString());
    expect(bodies).toEqual(['{"hostelId":"h"}', '{"hostelId":"h"}']);
  });
});

describe("failures never leak internals", () => {
  it("an unreachable backend becomes a 503 envelope", async () => {
    backend.mockRejectedValue(new TypeError("connect ECONNREFUSED 127.0.0.1:4000"));
    const res = await handleBff(req("GET", "hostels"), ["hostels"]);
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/);
    expect(text).toMatch(/DEPENDENCY_UNAVAILABLE/);
  });
  it("becoming a host rotates the tokens so the new role applies immediately", async () => {
    refreshSession.mockResolvedValue({ accessToken: "ATX", refreshToken: "RTX", expiresIn: 900, user: { id: "u" } });
    backend.mockResolvedValue(json({ id: "u", roles: ["GUEST", "OWNER"] }));
    const res = await handleBff(req("POST", "me/become-owner", { cookies: "hb_at=old; hb_rt=RT1" }), seg("me/become-owner"));
    expect(refreshSession).toHaveBeenCalledWith("RT1");
    expect(setCookies(res).join("\n")).toMatch(/hb_at=ATX/);
  });
});
