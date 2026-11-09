import { NextResponse, type NextRequest } from "next/server";
import { handleBff } from "@/lib/server/bff";

/**
 * "Who am I?" for the UI. Signed-out is a normal answer, not an error: 200 with `data: null`
 * (a 401 would show up as a red error in every visitor's console).
 */
export async function GET(req: NextRequest) {
  const res = await handleBff(req, ["me"]);
  if (res.status !== 401) return res;
  const out = NextResponse.json({ data: null, meta: { requestId: "bff" } }, { headers: { "cache-control": "no-store" } });
  for (const c of res.cookies.getAll()) out.cookies.set(c); // keep cookie clearing from a failed refresh
  return out;
}
