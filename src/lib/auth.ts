import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@clerk/backend";
import { supabaseAdmin } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuthContext {
  userId: string;
  email: string;
  orgId: string | null;
  orgRole: string | null;
  supabase: SupabaseClient;
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

    const email =
      (payload as Record<string, unknown>).email as string | undefined;
    const orgId =
      (payload as Record<string, unknown>).org_id as string | undefined;
    const orgRole =
      (payload as Record<string, unknown>).org_role as string | undefined;

    return {
      userId: payload.sub,
      email: email ?? "",
      orgId: orgId ?? null,
      orgRole: orgRole ?? null,
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

/**
 * Check whether the authenticated user belongs to the Promethean org
 * (has access to all tenants).
 */
export function isPrometheanUser(auth: AuthContext): boolean {
  return auth.orgId === process.env.CLERK_PROMETHEAN_ORG_ID;
}

/**
 * Verify the user has access to a specific tenant.
 * Promethean users can access all tenants.
 * Client users can only access tenants mapped to their Clerk org.
 */
export async function requireTenantAccess(
  auth: AuthContext,
  tenantId: string
): Promise<NextResponse | null> {
  if (isPrometheanUser(auth)) return null;

  // Look up the tenant and check if its linked org matches the user's org
  const { data: tenant } = await auth.supabase
    .from("tenants")
    .select("clerk_org_id")
    .eq("id", tenantId)
    .single();

  if (!tenant || tenant.clerk_org_id !== auth.orgId) {
    return NextResponse.json(
      { data: null, error: "Forbidden: no access to this tenant" },
      { status: 403 }
    );
  }

  return null;
}
