import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("csv", () => {
  it("quotes every cell, doubles quotes, and keeps commas and new lines inside the cell", () => {
    expect(toCsv([["Name", "Note"], ['A "B"', "one, two\nthree"]])).toBe('"Name","Note"\r\n"A ""B""","one, two\nthree"\r\n');
  });
  it("blanks empty cells and keeps numbers readable", () => {
    expect(toCsv([[null, undefined, 0, -5.5]])).toBe('"","","0","-5.5"\r\n');
  });
  it.each(["=SUM(A1:A9)", "+91 98765", "-2+3", "@cmd", "\tx", "\rx"])("defuses a cell a spreadsheet would run as a formula: %j", (v) => {
    expect(toCsv([[v]]).startsWith(`"'${v.replace(/"/g, '""')}`)).toBe(true);
  });
  it("leaves ordinary text and negative numbers alone", () => {
    expect(toCsv([["Asha Rao", -300]])).toBe('"Asha Rao","-300"\r\n');
  });
});
