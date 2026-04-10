import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify, decodeJwt, decodeProtectedHeader } from "jose";

const JWKS_URL = `${process.env.CLERK_JWKS_URL ?? "https://clerk.prmt.com"}/.well-known/jwks.json`;
const JWKS = createRemoteJWKSet(new URL(JWKS_URL));

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  const header = req.headers.get("authorization");

  if (!header?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "No Bearer token", jwksUrl: JWKS_URL },
      { status: 400, headers: corsHeaders }
    );
  }

  const token = header.slice(7);

  try {
    // Decode without verification first
    const jwtHeader = decodeProtectedHeader(token);
    const claims = decodeJwt(token);

    // Now try verification
    let verified = false;
    let verifyError: string | null = null;
    try {
      await jwtVerify(token, JWKS);
      verified = true;
    } catch (e) {
      verifyError = e instanceof Error ? e.message : String(e);
    }

    return NextResponse.json(
      {
        jwksUrl: JWKS_URL,
        header: jwtHeader,
        claims: {
          iss: claims.iss,
          sub: claims.sub,
          aud: claims.aud,
          exp: claims.exp,
          iat: claims.iat,
          email: (claims as Record<string, unknown>).email,
        },
        tokenExpired: claims.exp ? claims.exp * 1000 < Date.now() : "no exp",
        verified,
        verifyError,
      },
      { headers: corsHeaders }
    );
  } catch (e) {
    return NextResponse.json(
      {
        error: "Failed to decode token",
        detail: e instanceof Error ? e.message : String(e),
        jwksUrl: JWKS_URL,
        tokenPreview: token.substring(0, 50) + "...",
      },
      { status: 400, headers: corsHeaders }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin ?? "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
