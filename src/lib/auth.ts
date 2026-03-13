import { NextRequest, NextResponse } from "next/server";
import { createUserClient, supabaseAnon } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuthContext {
  userId: string;
  email: string;
  supabase: SupabaseClient; // user-scoped client (respects RLS)
}

/**
 * Extract and verify the Supabase session from the Authorization header.
 * Returns either an AuthContext on success or a NextResponse error.
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

  // Verify the JWT against Supabase Auth
  const {
    data: { user },
    error,
  } = await supabaseAnon.auth.getUser(token);

  if (error || !user) {
    return NextResponse.json(
      { data: null, error: "Invalid or expired token" },
      { status: 401 }
    );
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    supabase: createUserClient(token),
  };
}

/**
 * Type guard to check if requireAuth returned an error response.
 */
export function isAuthError(
  result: AuthContext | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}
