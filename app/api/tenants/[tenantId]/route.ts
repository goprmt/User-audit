import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ tenantId: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId } = await params;

  const { data: tenant, error } = await auth.supabase
    .from("tenants")
    .select("*")
    .eq("id", tenantId)
    .single();

  if (error || !tenant) {
    return NextResponse.json(
      { data: null, error: "Tenant not found" },
      { status: 404 }
    );
  }

  // Also fetch integration count and user count
  const [intgResult, userResult] = await Promise.all([
    auth.supabase
      .from("integrations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
    auth.supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
  ]);

  return NextResponse.json({
    data: {
      ...tenant,
      integrationCount: intgResult.count ?? 0,
      userCount: userResult.count ?? 0,
    },
    error: null,
  });
}
