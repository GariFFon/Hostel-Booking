import { describe, expect, it } from "vitest";
import { isLongTerm, priceUnitFor, propertyLabel, PROPERTY_TYPES } from "./property";

describe("property types", () => {
  it("only hotels are booked nightly; hostels and PGs are long-term", () => {
    expect(isLongTerm("HOTEL")).toBe(false);
    expect(isLongTerm("HOSTEL")).toBe(true);
    expect(isLongTerm("PG")).toBe(true);
  });

  it("each type has one price unit and a label", () => {
    expect(priceUnitFor("HOTEL")).toBe("NIGHT");
    expect(priceUnitFor("HOSTEL")).toBe("MONTH");
    expect(priceUnitFor("PG")).toBe("MONTH");
    expect(PROPERTY_TYPES.map(propertyLabel)).toEqual(["Hostel", "PG", "Hotel"]);
  });
});
