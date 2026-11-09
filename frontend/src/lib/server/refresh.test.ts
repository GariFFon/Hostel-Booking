import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.fn();
vi.mock("./backend", async (orig) => ({ ...(await orig<typeof import("./backend")>()), backend: (...a: unknown[]) => backend(...a) }));

import { _resetRefreshMemo, refreshSession } from "./refresh";

const tokens = (n: number) => ({ accessToken: `at${n}`, refreshToken: `rt${n}`, expiresIn: 900, user: { id: "u" } });
const ok = (n: number) => new Response(JSON.stringify({ data: tokens(n) }), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => { _resetRefreshMemo(); backend.mockReset(); });

describe("refreshSession: the backend revokes a token family if an old refresh token is replayed", () => {
  it("shares ONE backend call between concurrent requests that carry the same token", async () => {
    let release!: () => void;
    backend.mockImplementation(() => new Promise<Response>((res) => { release = () => res(ok(1)); }));
    const calls = [refreshSession("old"), refreshSession("old"), refreshSession("old")];
    release();
    const results = await Promise.all(calls);
    expect(backend).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r?.accessToken === "at1")).toBe(true);
  });

  it("hands late arrivals (requests already in flight with the old cookie) the same new tokens instead of replaying the old one", async () => {
    backend.mockResolvedValue(ok(1));
    const first = await refreshSession("old");
    const late = await refreshSession("old"); // arrives after the first call finished
    expect(backend).toHaveBeenCalledTimes(1);
    expect(late).toEqual(first);
  });

  it("different refresh tokens refresh independently", async () => {
    backend.mockResolvedValueOnce(ok(1)).mockResolvedValueOnce(ok(2));
    expect((await refreshSession("a"))?.accessToken).toBe("at1");
    expect((await refreshSession("b"))?.accessToken).toBe("at2");
    expect(backend).toHaveBeenCalledTimes(2);
  });

  it("an invalid or revoked token means signed out (null), and is not retried against the backend", async () => {
    backend.mockResolvedValue(new Response("{}", { status: 401 }));
    expect(await refreshSession("dead")).toBeNull();
    expect(await refreshSession("dead")).toBeNull();
    expect(backend).toHaveBeenCalledTimes(1);
  });

  it("a transient failure (5xx, rate limit, network) is NOT a sign-out and can be retried", async () => {
    backend.mockResolvedValueOnce(new Response("{}", { status: 503 })).mockResolvedValueOnce(ok(1));
    await expect(refreshSession("t")).rejects.toThrow(/503/);
    expect((await refreshSession("t"))?.accessToken).toBe("at1");
    backend.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(refreshSession("n")).rejects.toThrow();
  });

  it("a 200 without tokens is an error, not a session", async () => {
    backend.mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    await expect(refreshSession("x")).rejects.toThrow(/no tokens/);
  });
});
