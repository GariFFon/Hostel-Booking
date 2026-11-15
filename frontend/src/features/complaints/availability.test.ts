import { describe, expect, it } from "vitest";
import { defaultFreeTime, fmtSpan, freeTimeRange, toInstant } from "./availability";

const ahead = (days: number) => { const d = new Date(Date.now() + days * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

describe("the tenant's free time", () => {
  it("defaults to tomorrow, daytime, and is already valid", () => {
    const v = defaultFreeTime();
    expect(v).toMatchObject({ from: "09:00", to: "21:00", allowEntry: false });
    expect(typeof freeTimeRange(v)).toBe("object");
  });

  it("turns a local day and times into instants the API accepts", () => {
    const r = freeTimeRange({ date: ahead(2), from: "10:00", to: "13:00", allowEntry: true });
    expect(r).toMatchObject({ allowEntryIfAway: true });
    if (typeof r === "string") throw new Error(r);
    expect(new Date(r.availableTo).getTime() - new Date(r.availableFrom).getTime()).toBe(3 * 3_600_000);
    expect(r.availableFrom).toBe(toInstant(ahead(2), "10:00"));
  });

  it.each([
    [{ date: "", from: "10:00", to: "13:00" }, /Choose a day/],
    [{ date: ahead(2), from: "", to: "13:00" }, /Choose a day/],
    [{ date: ahead(2), from: "13:00", to: "10:00" }, /after the start/],
    [{ date: ahead(2), from: "10:00", to: "10:30" }, /at least an hour/],
    [{ date: ahead(-2), from: "10:00", to: "13:00" }, /already passed/],
  ])("explains what is wrong with %j", (v, message) => {
    const r = freeTimeRange({ ...v, allowEntry: false });
    expect(typeof r).toBe("string");
    expect(r).toMatch(message);
  });

  it("shows a range in words, with the day once when it is one day", () => {
    const a = new Date(2027, 1, 3, 10, 0).toISOString();
    const b = new Date(2027, 1, 3, 13, 30).toISOString();
    const text = fmtSpan(a, b);
    expect(text).toMatch(/3 Feb/);
    expect(text.match(/Feb/g)).toHaveLength(1);
    expect(text).toMatch(/10:00/);
    expect(text).toMatch(/1:30/);
  });
});
