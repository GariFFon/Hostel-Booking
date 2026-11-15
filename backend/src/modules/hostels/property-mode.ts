import { z } from 'zod';

/**
 * HOTEL is the short-term, nightly-booking type (check-in/check-out, hold timer, per-night inventory).
 * HOSTEL and PG are long-term: tenants hold a bed/room on a tenancy and pay monthly rent.
 */
export const PROPERTY_TYPES = ['HOSTEL', 'PG', 'HOTEL'] as const;
export const propertyTypeSchema = z.enum(PROPERTY_TYPES);
export type PropertyTypeName = (typeof PROPERTY_TYPES)[number];

export type StayMode = 'NIGHTLY' | 'TENANCY';
export const stayModeOf = (type: PropertyTypeName): StayMode => (type === 'HOTEL' ? 'NIGHTLY' : 'TENANCY');

/** The only price unit a room of that stay mode may use. */
export const priceUnitFor = (mode: StayMode): 'NIGHT' | 'MONTH' => (mode === 'NIGHTLY' ? 'NIGHT' : 'MONTH');
