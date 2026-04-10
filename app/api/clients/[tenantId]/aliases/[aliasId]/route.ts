import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ tenantId: string; aliasId: string }>;
}

// DELETE /api/clients/[tenantId]/aliases/[aliasId]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId, aliasId } = await params;

  const { error } = await auth.supabase
    .from("user_aliases")
    .delete()
    .eq("id", aliasId)
    .eq("tenant_id", tenantId);

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
