import { describe, expect, it } from "vitest";
import { addDays, bps, countdown, fmtDate, fmtRange, initials, money, nightsBetween, plural, timeAgo } from "./format";

describe("money (paise in, Indian grouping out)", () => {
  it.each([
    [80000, "₹800"], [168000, "₹1,680"], [12345678, "₹1,23,456.78"], [100, "₹1"], [99, "₹0.99"], [0, "₹0"], [98765432100, "₹98,76,54,321"],
  ])("%d -> %s", (paise, out) => expect(money(paise)).toBe(out));
  it("shows paise when asked and never renders NaN/undefined", () => {
    expect(money(168000, { exact: true })).toBe("₹1,680.00");
    expect(money(null)).toBe("—");
    expect(money(undefined)).toBe("—");
    expect(money(Number.NaN)).toBe("—");
  });
});

describe("plural", () => {
  it.each([[0, "0 stays"], [1, "1 stay"], [2, "2 stays"], [1234567, "12,34,567 stays"]])("%d", (n, out) => expect(plural(n, "stay")).toBe(out));
  it("accepts an irregular plural", () => expect(plural(2, "person", "people")).toBe("2 people"));
});

describe("stay dates are calendar dates: no timezone shifting", () => {
  it("formats without moving the day", () => {
    expect(fmtDate("2026-12-01")).toBe("1 Dec");
    expect(fmtDate("2026-12-31", "long")).toBe("31 Dec 2026");
    expect(fmtRange("2026-12-30", "2027-01-02")).toBe("30 Dec 2026 – 2 Jan 2027");
    expect(fmtRange("2026-12-01", "2026-12-04")).toBe("1 Dec – 4 Dec 2026");
  });
  it("counts nights and adds days across months, years and leap days", () => {
    expect(nightsBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });
});

describe("initials (grapheme-safe)", () => {
  it.each([["Asha Rao", "AR"], ["Jo", "J"], ["Aleksandra Wiśniewska-Kowalczyk", "AW"], ["😀 Smith", "😀S"], ["  ", "?"], ["", "?"], [null, "?"], [undefined, "?"], ["Åsa Öberg", "ÅÖ"]])("%j -> %s", (n, out) => expect(initials(n as string)).toBe(out));
});

describe("time", () => {
  const now = Date.parse("2026-11-09T10:00:00Z");
  it("relative past", () => {
    expect(timeAgo("2026-11-09T09:59:50Z", now)).toBe("just now");
    expect(timeAgo("2026-11-09T09:30:00Z", now)).toBe("30 minutes ago");
    expect(timeAgo("2026-11-09T07:00:00Z", now)).toBe("3 hours ago");
    expect(timeAgo("2026-11-08T10:00:00Z", now)).toBe("yesterday");
  });
  it("countdown ends cleanly", () => {
    expect(countdown("2026-11-09T10:04:05Z", now)).toBe("4m 05s");
    expect(countdown("2026-11-09T12:30:00Z", now)).toBe("2h 30m");
    expect(countdown("2026-11-09T09:59:59Z", now)).toBeNull();
  });
  it("basis points", () => { expect(bps(500)).toBe("5%"); expect(bps(1250)).toBe("12.5%"); });
});
