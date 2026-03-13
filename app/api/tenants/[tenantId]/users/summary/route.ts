import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ tenantId: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId } = await params;

  // Total / active / inactive counts
  const [totalRes, activeRes, inactiveRes] = await Promise.all([
    auth.supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
    auth.supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_active", true),
    auth.supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_active", false),
  ]);

  // Per-integration breakdown
  const { data: integrations } = await auth.supabase
    .from("integrations")
    .select("id, app_name")
    .eq("tenant_id", tenantId);

  const byIntegration: { integrationId: string; appName: string; userCount: number }[] = [];

  for (const intg of integrations ?? []) {
    const { count } = await auth.supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("integration_id", intg.id);

    byIntegration.push({
      integrationId: intg.id,
      appName: intg.app_name,
      userCount: count ?? 0,
    });
  }

  return NextResponse.json({
    data: {
      total: totalRes.count ?? 0,
      active: activeRes.count ?? 0,
      inactive: inactiveRes.count ?? 0,
      byIntegration,
    },
    error: null,
  });
}
