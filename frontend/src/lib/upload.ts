import { api, unwrapData } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";

export type UploadPurpose = "HOSTEL_IMAGE" | "ROOM_IMAGE" | "AVATAR" | "KYC_DOCUMENT";

/**
 * Direct-to-Cloudinary upload. Our server signs the exact parameters (folder, formats, size) and the file goes straight
 * from the browser to Cloudinary: the API secret never leaves the backend and big files never pass through our servers.
 * Returns the public_id to hand back to the API, which re-verifies the asset with Cloudinary before trusting it.
 */
export async function uploadToCloudinary(file: File, purpose: UploadPurpose, opts: { hostelId?: string; onProgress?: (pct: number) => void; signal?: AbortSignal } = {}) {
  const sig = await unwrapData(api.POST("/uploads/signature", { body: { purpose, ...(opts.hostelId ? { hostelId: opts.hostelId } : {}) } }));
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.size > sig.maxBytes) throw new ApiError(422, "VALIDATION_FAILED", `That file is too large. The limit is ${Math.round(sig.maxBytes / 1_048_576)} MB.`);
  if (!sig.allowedFormats.includes(ext)) throw new ApiError(422, "VALIDATION_FAILED", `Unsupported file type. Use ${sig.allowedFormats.join(", ").toUpperCase()}.`);

  const form = new FormData();
  for (const [k, v] of Object.entries(sig.fields)) form.append(k, v);
  form.append("file", file);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", sig.uploadUrl);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) opts.onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(502, "UPLOAD_FAILED", "The upload didn't go through. Please try again.")));
    xhr.onerror = () => reject(new TypeError("network"));
    opts.signal?.addEventListener("abort", () => { xhr.abort(); reject(new DOMException("Aborted", "AbortError")); });
    xhr.send(form);
  });
  opts.onProgress?.(100);
  return { publicId: sig.publicId };
}
