import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_ORIGINS = [
  'https://user-audie.lovable.app',
  'https://user-audit-lotf8e8kv-prmt.vercel.app',
  // Add additional frontend origins here as needed
];

const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization';

export function middleware(req: NextRequest) {
  const origin = req.headers.get('origin');
  const isAllowedOrigin = !!origin && ALLOWED_ORIGINS.includes(origin);

  if (req.method === 'OPTIONS') {
    const headers = new Headers();

    if (isAllowedOrigin) {
      headers.set('Access-Control-Allow-Origin', origin);
    }

    headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
    headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    headers.set('Access-Control-Max-Age', '86400');
    headers.set('Vary', 'Origin');

    return new NextResponse(null, {
      status: 204,
      headers,
    });
  }

  const res = NextResponse.next();

  if (isAllowedOrigin) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
    res.headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    res.headers.set('Vary', 'Origin');
  }

  return res;
}

export const config = {
  matcher: '/api/:path*',
};