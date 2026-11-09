import type { paths } from "./schema";

type Success = 200 | 201;
type JsonOf<R> = R extends { content: { "application/json": infer B } } ? B : never;

/** The `data` of a successful response: `Data<"/hostels/{idOrSlug}">` or `Data<"/bookings", "post", 201>`. */
export type Data<P extends keyof paths, M extends keyof paths[P] = "get" & keyof paths[P], S extends Success = 200> =
  paths[P][M] extends { responses: infer R } ? (S extends keyof R ? (JsonOf<R[S]> extends { data: infer D } ? D : never) : never) : never;

/** Items of a list response (`data: T[]`). */
export type Item<P extends keyof paths, M extends keyof paths[P] = "get" & keyof paths[P], S extends Success = 200> = Data<P, M, S> extends (infer I)[] ? I : never;

/** The JSON request body. */
export type Body<P extends keyof paths, M extends keyof paths[P]> =
  paths[P][M] extends { requestBody?: infer B } ? (B extends { content: { "application/json": infer J } } ? J : never) : never;

/** The query parameters. */
export type Query<P extends keyof paths, M extends keyof paths[P] = "get" & keyof paths[P]> =
  paths[P][M] extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never;

// Names used all over the UI
export type SessionUser = Data<"/me">;
export type SearchItem = Item<"/hostels">;
export type HostelDetail = Data<"/hostels/{idOrSlug}">;
export type BookingDetail = Data<"/bookings/{id}">;
export type BookingSummary = Item<"/bookings">;
export type Quote = Data<"/quotes", "post">;
