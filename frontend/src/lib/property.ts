/**
 * HOTEL = short stays booked by the night. HOSTEL and PG = long-term stays: a tenancy with monthly rent.
 * Mirrors backend/src/modules/hostels/property-mode.ts.
 */
export type PropertyType = "HOSTEL" | "PG" | "HOTEL";

const LABEL: Record<PropertyType, string> = { HOTEL: "Hotel", HOSTEL: "Hostel", PG: "PG" };

export const PROPERTY_TYPES: readonly PropertyType[] = ["HOSTEL", "PG", "HOTEL"];
export const propertyLabel = (t: PropertyType) => LABEL[t];
/** Rented on a tenancy with monthly rent instead of booked nightly. */
export const isLongTerm = (t: PropertyType) => t !== "HOTEL";
/** The only price unit a room may use for this type of property. */
export const priceUnitFor = (t: PropertyType): "NIGHT" | "MONTH" => (isLongTerm(t) ? "MONTH" : "NIGHT");
