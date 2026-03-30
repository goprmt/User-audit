import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ tenantId: string; snapshotId: string }>;
}

/**
 * GET /api/clients/:tenantId/snapshots/:snapshotId
 * Returns the full snapshot including snapshot_data (findings array) for CSV export.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId, snapshotId } = await params;

  const { data, error } = await auth.supabase
    .from("audit_snapshots")
    .select("*")
    .eq("id", snapshotId)
    .eq("tenant_id", tenantId)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { data: null, error: "Snapshot not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ data, error: null });
}
