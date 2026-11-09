import "server-only";
import type { NextResponse } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_TTL_SECONDS, cookieBase } from "./config";
import type { Tokens } from "./backend";

/** The access cookie expires slightly before the JWT does, so we refresh ahead of a 401 instead of after one. */
export function setSessionCookies(res: NextResponse, t: Pick<Tokens, "accessToken" | "refreshToken" | "expiresIn">) {
  res.cookies.set(ACCESS_COOKIE, t.accessToken, { ...cookieBase, maxAge: Math.max(30, t.expiresIn - 30) });
  res.cookies.set(REFRESH_COOKIE, t.refreshToken, { ...cookieBase, maxAge: REFRESH_TTL_SECONDS });
}

export function clearSessionCookies(res: NextResponse) {
  res.cookies.set(ACCESS_COOKIE, "", { ...cookieBase, maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, "", { ...cookieBase, maxAge: 0 });
}
