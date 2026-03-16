import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ tenantId: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId } = await params;

  // Fetch all integrations so we can separate JumpCloud from the rest
  const { data: integrations } = await auth.supabase
    .from("integrations")
    .select("id, app_name")
    .eq("tenant_id", tenantId);

  const allIntegrations = integrations ?? [];

  // JumpCloud is the source of truth for headcount stats
  const jumpcloudIds = allIntegrations
    .filter((i) => i.app_name?.toLowerCase() === "jumpcloud")
    .map((i) => i.id);

  // Build total/active/inactive from JumpCloud rows only (or fall back to all
  // users when no JumpCloud integration exists yet)
  const scopedIds = jumpcloudIds.length > 0 ? jumpcloudIds : null;

  const buildQuery = (isActiveFilter?: boolean) => {
    let q = auth.supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);

    if (scopedIds) {
      q = q.in("integration_id", scopedIds);
    }

    if (isActiveFilter !== undefined) {
      q = q.eq("is_active", isActiveFilter);
    }

    return q;
  };

  const [totalRes, activeRes, inactiveRes] = await Promise.all([
    buildQuery(),
    buildQuery(true),
    buildQuery(false),
  ]);

  // Per-integration breakdown (all integrations, not just JumpCloud)
  const byIntegration: {
    integrationId: string;
    appName: string;
    userCount: number;
  }[] = [];

  for (const intg of allIntegrations) {
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
