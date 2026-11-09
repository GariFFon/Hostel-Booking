import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-redirect";

describe("safeNext (no open redirects after sign-in)", () => {
  it.each(["/account/bookings", "/hostels/x?checkIn=2027-01-01", "/"])("keeps %s", (p) => expect(safeNext(p)).toBe(p));
  it.each([null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "evil.example", "/ok://x"])("rejects %j", (p) => expect(safeNext(p as string)).toBe("/"));
  it("uses the given fallback", () => expect(safeNext("//x", "/account")).toBe("/account"));
});
