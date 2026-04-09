import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { createUserClient } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuthContext {
  userId: string;
  email: string;
  supabase: SupabaseClient; // user-scoped client (respects RLS)
}

// Supabase JWT secret — same key used in the Clerk "supabase" JWT template
const JWT_SECRET = new TextEncoder().encode(
  process.env.SUPABASE_JWT_SECRET!
);

/**
 * Verify the JWT from the Authorization header using the Supabase JWT secret.
 * This works with Clerk tokens issued via the "supabase" JWT template, which
 * signs tokens with the Supabase JWT secret so they pass Supabase RLS checks
 * without requiring the user to exist in Supabase's auth.users table.
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
    const { payload } = await jwtVerify(token, JWT_SECRET);

    if (!payload.sub) {
      throw new Error("No sub claim in token");
    }

    return {
      userId: payload.sub,
      email: (payload as Record<string, unknown>).email as string ?? "",
      supabase: createUserClient(token),
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
