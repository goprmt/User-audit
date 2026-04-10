import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { supabaseAdmin } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuthContext {
  userId: string;
  email: string;
  supabase: SupabaseClient;
}

// Clerk JWKS endpoints — try production first, fall back to dev
// (Lovable overrides the Clerk key on their platform, so tokens may come from either instance)
const JWKS_PROD = createRemoteJWKSet(
  new URL("https://clerk.prmt.com/.well-known/jwks.json")
);
const JWKS_DEV = createRemoteJWKSet(
  new URL("https://content-worm-26.clerk.accounts.dev/.well-known/jwks.json")
);

/**
 * Verify the Clerk JWT from the Authorization header using Clerk's public JWKS.
 * Uses supabaseAdmin for DB access since this is a trusted server-side API.
 */
export async function requireAuth(
  req: NextRequest
): Promise<AuthContext | NextResponse> {
  const header = req.headers.get("authorization");

  if (!header?.startsWith("Bearer ")) {
    return NextResponse.json(
      { data: null, error: "Missing or malformed Authorization header" },
      { status: 401 }
    );
  }

  const token = header.slice(7);

  try {
    // Try production JWKS first, then dev (Lovable may override the Clerk key)
    let payload;
    try {
      ({ payload } = await jwtVerify(token, JWKS_PROD));
    } catch {
      ({ payload } = await jwtVerify(token, JWKS_DEV));
    }

    if (!payload.sub) {
      throw new Error("No sub claim in token");
    }

    return {
      userId: payload.sub,
      email: (payload as Record<string, unknown>).email as string ?? "",
      supabase: supabaseAdmin,
    };
  } catch {
    return NextResponse.json(
      { data: null, error: "Invalid or expired token" },
      { status: 401 }
    );
  }
}

/**
 * Type guard to check if requireAuth returned an error response.
 */
export function isAuthError(
  result: AuthContext | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}
