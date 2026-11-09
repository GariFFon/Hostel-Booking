/** The search state lives in the URL: shareable, back-button friendly, survives reload. */
export const SORT_OPTIONS = [
  { value: "recommended", label: "Recommended" }, { value: "price_asc", label: "Price: low to high" }, { value: "price_desc", label: "Price: high to low" },
  { value: "rating", label: "Top rated" }, { value: "newest", label: "Newest" }, { value: "distance", label: "Nearest" },
] as const;
export type SortValue = (typeof SORT_OPTIONS)[number]["value"];

export interface SearchFilters {
  q?: string; city?: string; lat?: number; lng?: number; radiusKm?: number;
  checkIn?: string; checkOut?: string; guests: number;
  minPrice?: number; maxPrice?: number; amenities: string[];
  propertyType?: "HOSTEL" | "PG"; roomKind?: "DORM" | "PRIVATE"; gender?: "MALE" | "FEMALE";
  minRating?: number; instantBook?: boolean; sort?: SortValue; view: "list" | "map";
  /** minLng,minLat,maxLng,maxLat: set by "Search this area" on the map. */
  bbox?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: string | null) => { if (v === null || v === "") return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const oneOf = <T extends string>(v: string | null, allowed: readonly T[]) => (v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);

export function parseFilters(sp: URLSearchParams): SearchFilters {
  const checkIn = sp.get("checkIn"), checkOut = sp.get("checkOut");
  const dates = checkIn && checkOut && DATE.test(checkIn) && DATE.test(checkOut) && checkOut > checkIn;
  const lat = num(sp.get("lat")), lng = num(sp.get("lng"));
  const guests = Math.min(30, Math.max(1, Math.trunc(num(sp.get("guests")) ?? 1)));
  return {
    q: sp.get("q")?.trim().slice(0, 100) || undefined,
    city: sp.get("city")?.trim().slice(0, 80) || undefined,
    ...(lat !== undefined && lng !== undefined ? { lat, lng, radiusKm: num(sp.get("radiusKm")) } : {}),
    ...(dates ? { checkIn: checkIn!, checkOut: checkOut! } : {}),
    guests,
    minPrice: num(sp.get("minPrice")), maxPrice: num(sp.get("maxPrice")),
    amenities: (sp.get("amenities") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 20),
    propertyType: oneOf(sp.get("propertyType"), ["HOSTEL", "PG"] as const),
    roomKind: oneOf(sp.get("roomKind"), ["DORM", "PRIVATE"] as const),
    gender: oneOf(sp.get("gender"), ["MALE", "FEMALE"] as const),
    minRating: num(sp.get("minRating")),
    instantBook: sp.get("instantBook") === "true" ? true : undefined,
    sort: oneOf(sp.get("sort"), SORT_OPTIONS.map((o) => o.value)),
    view: sp.get("view") === "map" ? "map" : "list",
    bbox: /^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/.test(sp.get("bbox") ?? "") ? sp.get("bbox")! : undefined,
  };
}

/** Query for GET /hostels (and /hostels/map): only what is set, as the API expects it. */
export function toApiQuery(f: SearchFilters): Record<string, string | number | boolean> {
  const q: Record<string, string | number | boolean> = { guests: f.guests };
  if (f.q) q.q = f.q;
  if (f.city) q.city = f.city;
  if (f.lat !== undefined && f.lng !== undefined) { q.lat = f.lat; q.lng = f.lng; if (f.radiusKm) q.radiusKm = f.radiusKm; }
  if (f.checkIn && f.checkOut) { q.checkIn = f.checkIn; q.checkOut = f.checkOut; }
  if (f.minPrice !== undefined) q.minPrice = f.minPrice;
  if (f.maxPrice !== undefined) q.maxPrice = f.maxPrice;
  if (f.amenities.length) q.amenities = f.amenities.join(",");
  if (f.propertyType) q.propertyType = f.propertyType;
  if (f.roomKind) q.roomKind = f.roomKind;
  if (f.gender) q.gender = f.gender;
  if (f.minRating !== undefined) q.minRating = f.minRating;
  if (f.instantBook) q.instantBook = true;
  if (f.sort) q.sort = f.sort;
  if (f.bbox) q.bbox = f.bbox;
  return q;
}

export function toSearchString(f: SearchFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(toApiQuery(f))) if (!(k === "guests" && v === 1)) p.set(k, String(v));
  if (f.view === "map") p.set("view", "map");
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** How many filters (beyond where/when/who) are active: drives the badge on the Filters button. */
export const activeFilterCount = (f: SearchFilters) =>
  [f.minPrice !== undefined || f.maxPrice !== undefined, f.amenities.length > 0, !!f.propertyType, !!f.roomKind, !!f.gender, f.minRating !== undefined, !!f.instantBook].filter(Boolean).length;

/** Amenity chips shown in the filter sheet (code → label); the full list comes from the API. */
export const POPULAR_AMENITIES = ["WIFI", "AC", "BREAKFAST", "LOCKERS", "LAUNDRY", "KITCHEN", "CCTV", "HOT_WATER", "POWER_BACKUP", "FEMALE_FLOOR"] as const;
