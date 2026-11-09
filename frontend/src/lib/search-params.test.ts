import { describe, expect, it } from "vitest";
import { activeFilterCount, parseFilters, toApiQuery, toSearchString } from "./search-params";

const parse = (q: string) => parseFilters(new URLSearchParams(q));

describe("search state in the URL", () => {
  it("round-trips a full filter set", () => {
    const f = parse("city=Goa&checkIn=2027-01-08&checkOut=2027-01-10&guests=3&minPrice=50000&maxPrice=150000&amenities=WIFI,AC&propertyType=HOSTEL&roomKind=DORM&gender=FEMALE&minRating=4&instantBook=true&sort=price_asc&view=map");
    expect(f).toMatchObject({ city: "Goa", checkIn: "2027-01-08", checkOut: "2027-01-10", guests: 3, minPrice: 50000, maxPrice: 150000, amenities: ["WIFI", "AC"], propertyType: "HOSTEL", roomKind: "DORM", gender: "FEMALE", minRating: 4, instantBook: true, sort: "price_asc", view: "map" });
    expect(parse(toSearchString(f).slice(1))).toEqual(f);
  });
  it("drops what can't be trusted instead of passing it to the API", () => {
    const f = parse("checkIn=2027-01-10&checkOut=2027-01-08&guests=999&sort=hax&propertyType=CASTLE&minPrice=abc&lat=12");
    expect(f.checkIn).toBeUndefined(); // check-out before check-in
    expect(f.guests).toBe(30); // clamped
    expect(f.sort).toBeUndefined();
    expect(f.propertyType).toBeUndefined();
    expect(f.minPrice).toBeUndefined();
    expect(f.lat).toBeUndefined(); // lat without lng
  });
  it("needs both dates, and ignores malformed ones", () => {
    expect(parse("checkIn=2027-01-08").checkIn).toBeUndefined();
    expect(parse("checkIn=tomorrow&checkOut=2027-01-08").checkIn).toBeUndefined();
  });
  it("builds a minimal API query", () => {
    expect(toApiQuery(parse("city=Goa"))).toEqual({ guests: 1, city: "Goa" });
    expect(toApiQuery(parse("lat=15.5&lng=73.8&radiusKm=10"))).toEqual({ guests: 1, lat: 15.5, lng: 73.8, radiusKm: 10 });
    expect(toSearchString(parse(""))).toBe("");
  });
  it("counts the filters behind the Filters button", () => {
    expect(activeFilterCount(parse("city=Goa&guests=2"))).toBe(0);
    expect(activeFilterCount(parse("minPrice=1&maxPrice=2&amenities=WIFI&instantBook=true"))).toBe(3);
  });
});
