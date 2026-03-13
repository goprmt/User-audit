import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ tenantId: string; integId: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId, integId } = await params;

  // Verify integration belongs to tenant
  const { data: intg } = await auth.supabase
    .from("integrations")
    .select("id")
    .eq("id", integId)
    .eq("tenant_id", tenantId)
    .single();

  if (!intg) {
    return NextResponse.json(
      { data: null, error: "Integration not found" },
      { status: 404 }
    );
  }

  const { data, error } = await auth.supabase
    .from("sync_logs")
    .select("*")
    .eq("integration_id", integId)
    .order("started_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json(
      { data: null, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ data, error: null });
}
