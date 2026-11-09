import { NextResponse, type NextRequest } from 'next/server';

// Next 16 "proxy" (formerly middleware): CORS for the browser-based website. The Flutter app is not a
// browser and ignores CORS. Origins come from CORS_ALLOWED_ORIGINS (read directly: proxy runs before env validation).
const ALLOW_HEADERS = 'Authorization, Content-Type, Idempotency-Key, X-Request-Id';
const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

export function proxy(req: NextRequest) {
  const allowed = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get('origin');
  const permitted = origin !== null && allowed.includes(origin);

  if (req.method === 'OPTIONS') {
    const res = new NextResponse(null, { status: permitted ? 204 : 403 });
    if (permitted) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.set('Access-Control-Allow-Methods', ALLOW_METHODS);
      res.headers.set('Access-Control-Allow-Headers', ALLOW_HEADERS);
      res.headers.set('Access-Control-Max-Age', '600');
      res.headers.set('Vary', 'Origin');
    }
    return res;
  }

  const res = NextResponse.next();
  if (permitted) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Expose-Headers', 'X-Request-Id, Retry-After');
    res.headers.set('Vary', 'Origin');
  }
  return res;
}

export const config = { matcher: '/api/:path*' };
