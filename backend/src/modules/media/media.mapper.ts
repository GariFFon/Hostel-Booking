import type { Media } from '@/generated/prisma/client';
import { transformUrl } from '@/infra/cloudinary/storage';

export interface MediaDto {
  id: string;
  roomTypeId: string | null;
  url: string;
  thumbUrl: string;
  cardUrl: string;
  fullUrl: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
  isCover: boolean;
}

/** Variants are derived on Cloudinary's CDN (auto format/quality), so we store only the original. */
export function toMediaDto(m: Media): MediaDto {
  return {
    id: m.id, roomTypeId: m.roomTypeId, url: m.url,
    thumbUrl: transformUrl(m.url, 'c_fill,w_320,h_240,f_auto,q_auto'),
    cardUrl: transformUrl(m.url, 'c_fill,w_640,h_480,f_auto,q_auto'),
    fullUrl: transformUrl(m.url, 'c_limit,w_1600,f_auto,q_auto'),
    altText: m.altText, width: m.width, height: m.height, sortOrder: m.sortOrder, isCover: m.isCover,
  };
}
