import { describe, expect, it } from 'vitest';
import { PROPERTY_TYPES, priceUnitFor, stayModeOf } from '@/modules/hostels/property-mode';

describe('property types and stay modes', () => {
  it('hotels are nightly; hostels and PGs are long-term tenancies', () => {
    expect(stayModeOf('HOTEL')).toBe('NIGHTLY');
    expect(stayModeOf('HOSTEL')).toBe('TENANCY');
    expect(stayModeOf('PG')).toBe('TENANCY');
  });

  it('each mode has exactly one price unit', () => {
    expect(priceUnitFor('NIGHTLY')).toBe('NIGHT');
    expect(priceUnitFor('TENANCY')).toBe('MONTH');
  });

  it('covers every property type the database knows', () => {
    expect([...PROPERTY_TYPES].sort()).toEqual(['HOSTEL', 'HOTEL', 'PG']);
  });
});
