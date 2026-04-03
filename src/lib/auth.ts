import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@clerk/backend";
import { supabaseAdmin } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuthContext {
  userId: string;
  email: string;
  supabase: SupabaseClient; // admin client — Clerk owns the session, not Supabase
}

/**
 * Extract and verify the Clerk session token from the Authorization header.
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

  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });

    return {
      userId: payload.sub,
      email: (payload as Record<string, unknown>)["email"] as string ?? "",
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
