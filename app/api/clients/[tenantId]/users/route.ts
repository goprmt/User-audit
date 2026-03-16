import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { usersQuerySchema } from "@/lib/validation";
import { ZodError } from "zod";

interface RouteParams {
  params: Promise<{ tenantId: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId } = await params;

  try {
    // Parse query params
    const url = new URL(req.url);
    const filters = usersQuerySchema.parse({
      integrationId: url.searchParams.get("integrationId") ?? undefined,
      licenseType: url.searchParams.get("licenseType") ?? undefined,
      isActive: url.searchParams.get("isActive") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const from = (filters.page - 1) * filters.limit;
    const to = from + filters.limit - 1;

    let query = auth.supabase
      .from("users")
      .select(
        "id, email, display_name, license_type, is_active, last_seen_at, synced_at, external_id, integration_id, integrations(app_name)",
        { count: "exact" }
      )
      .eq("tenant_id", tenantId)
      .order("email")
      .range(from, to);

    if (filters.integrationId) {
      query = query.eq("integration_id", filters.integrationId);
    }
    if (filters.licenseType) {
      query = query.eq("license_type", filters.licenseType);
    }
    if (filters.isActive !== undefined) {
      query = query.eq("is_active", filters.isActive);
    }

    const { data, count, error } = await query;

    if (error) {
      return NextResponse.json(
        { data: null, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: {
        users: data,
        meta: {
          total: count ?? 0,
          page: filters.page,
          limit: filters.limit,
          totalPages: Math.ceil((count ?? 0) / filters.limit),
        },
      },
      error: null,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { data: null, error: "Validation error", details: err.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { data: null, error: "Internal server error" },
      { status: 500 }
    );
  }
}
