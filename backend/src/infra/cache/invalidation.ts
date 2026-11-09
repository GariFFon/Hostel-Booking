import { invalidate } from './cache';

export const ns = {
  hostel: (id: string) => `hostel:${id}`,
  search: 'search',
  cities: 'cities',
  amenities: 'amenities',
  inventory: 'inventory',
  offers: 'offers',
} as const;

/** A hostel's public content changed (details, rooms, photos, price rules, status). */
export const invalidateHostel = (hostelId: string) => invalidate(ns.hostel(hostelId), ns.search, ns.cities);

/** Amenity definitions changed (labels appear inside hostel and search payloads). */
export const invalidateAmenities = () => invalidate(ns.amenities, ns.search);

/**
 * Availability changed (hold, booking, cancellation, expiry, calendar block, capacity change). Dated searches
 * and maps depend on this namespace; call it after the transaction commits.
 */
export const invalidateInventory = () => invalidate(ns.inventory);

/** A coupon was created, changed or removed (public offers on property pages depend on this). */
export const invalidateOffers = () => invalidate(ns.offers);
