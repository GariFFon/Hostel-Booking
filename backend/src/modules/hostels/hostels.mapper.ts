import type { Prisma } from '@/generated/prisma/client';
import { toMediaDto } from '@/modules/media/media.mapper';
import { toRoomTypeDto } from '@/modules/rooms/rooms.mapper';

export const hostelInclude = {
  amenities: { include: { amenity: true } },
  media: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
  roomTypes: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.HostelInclude;

export type HostelFull = Prisma.HostelGetPayload<{ include: typeof hostelInclude }>;

export function toHostelDto(h: HostelFull) {
  return {
    id: h.id, ownerId: h.ownerId, slug: h.slug, name: h.name, description: h.description, propertyType: h.propertyType,
    status: h.status, bookingMode: h.bookingMode, cancellationPolicy: h.cancellationPolicy, genderPolicy: h.genderPolicy,
    timezone: h.timezone, currency: h.currency,
    address: { line1: h.addressLine1, line2: h.addressLine2, locality: h.locality, city: h.city, state: h.state, postalCode: h.postalCode, country: h.country },
    location: { latitude: h.latitude, longitude: h.longitude },
    phone: h.phone, contactEmail: h.contactEmail, checkInTime: h.checkInTime, checkOutTime: h.checkOutTime,
    houseRules: h.houseRules, gstin: h.gstin,
    amenities: h.amenities.map((a) => ({ code: a.amenity.code, label: a.amenity.label, category: a.amenity.category, icon: a.amenity.icon })),
    media: h.media.map(toMediaDto),
    roomTypes: h.roomTypes.map(toRoomTypeDto),
    avgRating: h.avgRating, reviewCount: h.reviewCount, minPricePaise: h.minPricePaise,
    rejectionReason: h.rejectionReason, approvedAt: h.approvedAt?.toISOString() ?? null,
    version: h.version, createdAt: h.createdAt.toISOString(), updatedAt: h.updatedAt.toISOString(),
  };
}
export type HostelDto = ReturnType<typeof toHostelDto>;

/** Light list item (owner and admin lists). */
export function toHostelSummary(h: HostelFull) {
  const cover = h.media.find((m) => m.isCover) ?? h.media[0];
  return {
    id: h.id, slug: h.slug, name: h.name, city: h.city, propertyType: h.propertyType, status: h.status,
    coverUrl: cover ? toMediaDto(cover).cardUrl : null, roomTypeCount: h.roomTypes.length, mediaCount: h.media.length,
    minPricePaise: h.minPricePaise, avgRating: h.avgRating, reviewCount: h.reviewCount,
    rejectionReason: h.rejectionReason, updatedAt: h.updatedAt.toISOString(),
  };
}
