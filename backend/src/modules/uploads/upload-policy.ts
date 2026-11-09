import { randomUUID } from 'node:crypto';
import { env } from '@/core/config/env';
import type { DeliveryType } from '@/infra/cloudinary/storage';
import type { UploadPurpose } from './uploads.schema';

export interface PurposePolicy {
  type: DeliveryType;
  allowedFormats: string[];
  maxBytes: number;
}

const MB = 1024 * 1024;
export const PURPOSE_POLICY: Record<UploadPurpose, PurposePolicy> = {
  HOSTEL_IMAGE: { type: 'upload', allowedFormats: ['jpg', 'jpeg', 'png', 'webp'], maxBytes: 10 * MB },
  ROOM_IMAGE: { type: 'upload', allowedFormats: ['jpg', 'jpeg', 'png', 'webp'], maxBytes: 10 * MB },
  AVATAR: { type: 'upload', allowedFormats: ['jpg', 'jpeg', 'png', 'webp'], maxBytes: 3 * MB },
  KYC_DOCUMENT: { type: 'authenticated', allowedFormats: ['jpg', 'jpeg', 'png', 'pdf'], maxBytes: 8 * MB },
};

/** Environment-scoped root so local/test/prod never mix inside one Cloudinary cloud. */
const root = () => `${env().CLOUDINARY_FOLDER_PREFIX}/${env().APP_ENV}`;

/** The prefix an asset's public_id must start with for a given owner of the asset. */
export const prefixFor = {
  hostel: (hostelId: string) => `${root()}/hostels/${hostelId}/`,
  avatar: (userId: string) => `${root()}/users/${userId}/avatar/`,
  kyc: (userId: string) => `${root()}/kyc/${userId}/`,
};

export const newPublicId = (prefix: string) => `${prefix}${randomUUID()}`;
