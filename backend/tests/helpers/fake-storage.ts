import { cloudinaryStorage, type DeliveryType, type MediaStorage, type StoredResource } from '@/infra/cloudinary/storage';

/** In-memory Cloudinary. Signing uses the real implementation (pure crypto); everything else is simulated. */
export class FakeStorage implements MediaStorage {
  assets = new Map<string, StoredResource>();
  destroyed: string[] = [];

  signUpload = cloudinaryStorage.signUpload;

  /** Pretend the client finished uploading to a signed public_id. */
  put(publicId: string, opts: { format?: string; bytes?: number; type?: DeliveryType } = {}) {
    const type = opts.type ?? 'upload';
    this.assets.set(`${type}:${publicId}`, {
      publicId, type, format: opts.format ?? 'jpg', bytes: opts.bytes ?? 200_000, width: 1600, height: 1200, resourceType: 'image',
      secureUrl: `https://res.cloudinary.com/testcloud/image/${type}/v1/${publicId}.${opts.format ?? 'jpg'}`.replace('/image/upload/v1/', '/image/upload/'),
    });
  }
  async getResource(publicId: string, type: DeliveryType) {
    return this.assets.get(`${type}:${publicId}`) ?? null;
  }
  async destroy(publicId: string, type: DeliveryType) {
    this.assets.delete(`${type}:${publicId}`);
    this.destroyed.push(publicId);
  }
  privateDownloadUrl(publicId: string, format: string, expiresInSeconds: number) {
    return `https://api.cloudinary.com/v1_1/testcloud/image/download?public_id=${encodeURIComponent(publicId)}&format=${format}&ttl=${expiresInSeconds}`;
  }
}
