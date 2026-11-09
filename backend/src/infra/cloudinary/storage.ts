import { v2 as cloudinary } from 'cloudinary';
import { env } from '@/core/config/env';
import { AppError } from '@/core/errors/app-error';

export type DeliveryType = 'upload' | 'authenticated';

export interface SignedUpload {
  uploadUrl: string;
  /** Fields the client must POST (multipart) alongside `file`, exactly as given. */
  fields: Record<string, string>;
  publicId: string;
  expiresAt: string;
}

export interface StoredResource {
  publicId: string;
  secureUrl: string;
  bytes: number;
  format: string;
  width: number | null;
  height: number | null;
  resourceType: string;
  type: DeliveryType;
}

export interface MediaStorage {
  signUpload(p: { publicId: string; type: DeliveryType; allowedFormats: string[] }): SignedUpload;
  /** Reads what Cloudinary actually stored; returns null when the asset does not exist. */
  getResource(publicId: string, type: DeliveryType): Promise<StoredResource | null>;
  destroy(publicId: string, type: DeliveryType): Promise<void>;
  /** Short-lived URL for private (authenticated) assets such as KYC documents. */
  privateDownloadUrl(publicId: string, format: string, expiresInSeconds: number): string;
}

let configured = false;
function configure() {
  if (configured) return;
  const e = env();
  if (!e.CLOUDINARY_CLOUD_NAME || !e.CLOUDINARY_API_KEY || !e.CLOUDINARY_API_SECRET) {
    throw new AppError('DEPENDENCY_UNAVAILABLE', 'Media storage is not configured on this server');
  }
  cloudinary.config({ cloud_name: e.CLOUDINARY_CLOUD_NAME, api_key: e.CLOUDINARY_API_KEY, api_secret: e.CLOUDINARY_API_SECRET, secure: true });
  configured = true;
}

const SIGNATURE_TTL_SECONDS = 600;

export const cloudinaryStorage: MediaStorage = {
  signUpload({ publicId, type, allowedFormats }) {
    configure();
    const e = env();
    const timestamp = Math.floor(Date.now() / 1000);
    // Everything we sign is pinned: the client cannot choose another public_id, delivery type or format list.
    const toSign: Record<string, string | number> = {
      allowed_formats: allowedFormats.join(','),
      overwrite: 'false',
      public_id: publicId,
      timestamp,
      type,
    };
    const signature = cloudinary.utils.api_sign_request(toSign, e.CLOUDINARY_API_SECRET);
    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${e.CLOUDINARY_CLOUD_NAME}/image/upload`,
      fields: { ...Object.fromEntries(Object.entries(toSign).map(([k, v]) => [k, String(v)])), api_key: e.CLOUDINARY_API_KEY, signature },
      publicId,
      expiresAt: new Date((timestamp + SIGNATURE_TTL_SECONDS) * 1000).toISOString(),
    };
  },

  async getResource(publicId, type) {
    configure();
    try {
      const r = await cloudinary.api.resource(publicId, { resource_type: 'image', type });
      return { publicId: r.public_id, secureUrl: r.secure_url, bytes: r.bytes, format: r.format, width: r.width ?? null, height: r.height ?? null, resourceType: r.resource_type, type };
    } catch (err) {
      const status = (err as { error?: { http_code?: number }; http_code?: number }).error?.http_code ?? (err as { http_code?: number }).http_code;
      if (status === 404) return null;
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'Could not reach media storage');
    }
  },

  async destroy(publicId, type) {
    configure();
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image', type, invalidate: true });
  },

  privateDownloadUrl(publicId, format, expiresInSeconds) {
    configure();
    return cloudinary.utils.private_download_url(publicId, format, {
      resource_type: 'image',
      type: 'authenticated',
      expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    });
  },
};

let active: MediaStorage = cloudinaryStorage;
export const mediaStorage = (): MediaStorage => active;
/** Test seam: swap in a fake. */
export function setMediaStorage(s: MediaStorage) {
  active = s;
}

/** Inserts a Cloudinary transformation into a stored delivery URL, e.g. 'c_fill,w_600,h_400,f_auto,q_auto'. */
export function transformUrl(url: string, transformation: string): string {
  return url.includes('/upload/') ? url.replace('/upload/', `/upload/${transformation}/`) : url;
}
