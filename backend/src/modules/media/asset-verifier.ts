import { Errors } from '@/core/errors/app-error';
import { mediaStorage, type StoredResource } from '@/infra/cloudinary/storage';
import { PURPOSE_POLICY } from '@/modules/uploads/upload-policy';
import type { UploadPurpose } from '@/modules/uploads/uploads.schema';

/**
 * Never trusts what the client says about an upload. We confirm with Cloudinary that the asset exists,
 * lives under a path this actor is allowed to use, and satisfies size/format policy; otherwise it is deleted.
 */
export async function verifyUploadedAsset(purpose: UploadPurpose, publicId: string, expectedPrefix: string): Promise<StoredResource> {
  if (!publicId.startsWith(expectedPrefix)) {
    throw Errors.validation([{ path: 'publicId', message: 'This upload does not belong to this resource' }]);
  }
  const policy = PURPOSE_POLICY[purpose];
  const storage = mediaStorage();
  const resource = await storage.getResource(publicId, policy.type);
  if (!resource) throw Errors.validation([{ path: 'publicId', message: 'Upload not found. Finish uploading the file first.' }]);

  const reject = async (message: string) => {
    await storage.destroy(publicId, policy.type).catch(() => undefined);
    throw Errors.validation([{ path: 'publicId', message }]);
  };
  if (!policy.allowedFormats.includes(resource.format.toLowerCase())) await reject(`File type .${resource.format} is not allowed`);
  if (resource.bytes > policy.maxBytes) await reject(`File is larger than ${Math.round(policy.maxBytes / 1024 / 1024)} MB`);
  return resource;
}
