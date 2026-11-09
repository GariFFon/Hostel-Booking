import "server-only";

/** Server-only configuration. The browser never sees the backend URL or any token. */
export const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
export const API_V1 = `${API_URL}/api/v1`;

const secure = process.env.NODE_ENV === "production";
// `__Host-` cookies must be Secure + path=/ and are bound to this exact host: the strongest cookie scope we can get.
const prefix = secure ? "__Host-" : "";
export const ACCESS_COOKIE = `${prefix}hb_at`;
export const REFRESH_COOKIE = `${prefix}hb_rt`;
export const REFRESH_TTL_SECONDS = 30 * 24 * 3600; // matches the backend's refresh-token lifetime
export const cookieBase = { httpOnly: true, secure, sameSite: "lax" as const, path: "/" };
