import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_ORIGINS = [
  'https://user-audie.lovable.app',
  'https://prmt-user-audit.vercel.app',
];

const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization';

function isAllowed(origin: string | null): origin is string {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (origin.endsWith('.lovableproject.com') || origin.endsWith('.lovable.app')) return true;
  return false;
}

export function middleware(req: NextRequest) {
  const origin = req.headers.get('origin');
  const isAllowedOrigin = isAllowed(origin);

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