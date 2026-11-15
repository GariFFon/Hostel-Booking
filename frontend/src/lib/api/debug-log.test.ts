import { afterEach, describe, expect, it, vi } from "vitest";

async function load(env: string) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", env);
  return import("./debug-log");
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("maskDeep", () => {
  it("masks secrets at any depth and leaves the rest whole", async () => {
    const { maskDeep } = await load("development");
    const out = maskDeep({ email: "a@b.c", password: "hunter2", nested: [{ refreshToken: "r", code: "X1", ok: 1 }], idToken: "t" });
    expect(out).toEqual({ email: "a@b.c", password: "[MASKED]", nested: [{ refreshToken: "[MASKED]", code: "X1", ok: 1 }], idToken: "[MASKED]" });
  });
});

describe("withApiLog", () => {
  it("is a pure pass-through outside development (no log, no extra header)", async () => {
    const { withApiLog } = await load("production");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const impl = vi.fn<typeof fetch>(async () => new Response("{}"));
    await withApiLog(impl, "BROWSER")("http://x.test/a", { method: "POST", body: "{}" });
    expect(log).not.toHaveBeenCalled();
    expect(new Headers(impl.mock.calls[0]![1]?.headers).has("x-request-id")).toBe(false);
  });

  it("in development logs the request and the real response with one id, masked, and returns an unread response", async () => {
    const { withApiLog } = await load("development");
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m: unknown) => { lines.push(String(m)); });
    vi.spyOn(console, "groupCollapsed").mockImplementation(() => undefined);
    const impl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: { code: "VALIDATION_FAILED" }, accessToken: "secret-at" }), { status: 422, statusText: "Unprocessable" }));
    const res = await withApiLog(impl, "BFF→API")("http://x.test/api/v1/auth/login?q=1", {
      method: "POST", headers: { authorization: "Bearer abc", "content-type": "application/json" }, body: JSON.stringify({ email: "a@b.c", password: "hunter2" }),
    });
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED"); // the caller can still read it
    await new Promise((r) => setTimeout(r, 0));
    const all = lines.join("\n");
    expect(all).toContain("/api/v1/auth/login");
    expect(all).toContain("VALIDATION_FAILED");
    expect(all).toContain("a@b.c");
    expect(all).not.toContain("hunter2");
    expect(all).not.toContain("secret-at");
    expect(all).not.toContain("Bearer abc");
    const id = new Headers(impl.mock.calls[0]![1]?.headers).get("x-request-id")!;
    expect(all.split(id).length).toBeGreaterThan(2); // on both the request and the response entry
  });

  it("logs a network failure and rethrows it unchanged", async () => {
    const { withApiLog } = await load("development");
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m: unknown) => { lines.push(String(m)); });
    vi.spyOn(console, "groupCollapsed").mockImplementation(() => undefined);
    const boom = new TypeError("fetch failed");
    await expect(withApiLog((async () => { throw boom; }) as unknown as typeof fetch, "BROWSER")("http://x.test/a")).rejects.toBe(boom);
    expect(lines.join("\n")).toContain("NETWORK FAILURE");
  });
});
