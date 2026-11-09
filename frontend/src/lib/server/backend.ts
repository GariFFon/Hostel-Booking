import "server-only";
import { API_V1 } from "./config";

export interface BackendUser {
  id: string; email: string; fullName: string | null; phone: string | null; avatarUrl: string | null;
  roles: string[]; emailVerified: boolean; hasPassword: boolean; googleLinked: boolean; kycStatus: string | null;
}
export interface Tokens { accessToken: string; refreshToken: string; expiresIn: number; user: BackendUser }

export interface BackendInit {
  method?: string;
  body?: ArrayBuffer | string | null;
  contentType?: string | null;
  token?: string | null;
  headers?: Record<string, string>;
}

/** One call to the backend with a hard timeout. Network failure rejects; HTTP errors are returned as responses. */
export function backend(path: string, init: BackendInit = {}): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json", ...init.headers };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.contentType) headers["content-type"] = init.contentType;
  return fetch(`${API_V1}/${path.replace(/^\//, "")}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body ?? undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    redirect: "manual",
  });
}

export async function readEnvelope<T>(res: Response): Promise<{ data?: T; error?: { code: string; message: string } }> {
  try {
    return (await res.json()) as { data?: T; error?: { code: string; message: string } };
  } catch {
    return {};
  }
}
