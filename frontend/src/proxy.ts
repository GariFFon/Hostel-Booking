import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic route guard: signed-out visitors never see the signed-in areas flash by. This is a UX redirect only;
 * every API call is authorised by the backend, and the pages check the user's role after loading the session.
 * The cookie names mirror lib/server/config.ts (read here directly: proxy must stay dependency-free).
 */
const COOKIES = ["hb_rt", "__Host-hb_rt", "hb_at", "__Host-hb_at"];

export function proxy(req: NextRequest) {
  if (COOKIES.some((c) => req.cookies.has(c))) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/account/:path*", "/owner/:path*", "/admin/:path*", "/checkout/:path*"] };
