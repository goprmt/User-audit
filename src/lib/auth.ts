import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { supabaseAdmin } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuthContext {
  userId: string;
  email: string;
  supabase: SupabaseClient;
}

// Clerk's public JWKS — verifies tokens without needing any secrets
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLERK_JWKS_URL ?? "https://clerk.prmt.com"}/.well-known/jwks.json`)
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
    const { payload } = await jwtVerify(token, JWKS);

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
