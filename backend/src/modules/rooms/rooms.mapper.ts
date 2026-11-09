import type { RoomType } from '@/generated/prisma/client';

export function toRoomTypeDto(r: RoomType) {
  return {
    id: r.id, hostelId: r.hostelId, name: r.name, description: r.description, kind: r.kind, gender: r.gender,
    totalUnits: r.totalUnits, maxOccupancyPerUnit: r.maxOccupancyPerUnit, basePricePaise: r.basePricePaise, priceUnit: r.priceUnit,
    minStayNights: r.minStayNights, maxStayNights: r.maxStayNights, isActive: r.isActive, version: r.version,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}
export type RoomTypeDto = ReturnType<typeof toRoomTypeDto>;
