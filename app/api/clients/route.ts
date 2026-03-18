import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError, isPrometheanUser } from "@/lib/auth";
import { createTenantSchema } from "@/lib/validation";
import { ZodError } from "zod";

// GET /api/clients — list all clients with integration/user counts
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  // Promethean users see all tenants; client users only see their org's tenants
  let query = auth.supabase.from("tenants").select("*").order("name");
  if (!isPrometheanUser(auth) && auth.orgId) {
    query = query.eq("clerk_org_id", auth.orgId);
  }

  const { data: tenants, error } = await query;

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 });
  }

  // Enrich each tenant with integration count, user count, and last sync time
  const enriched = await Promise.all(
    (tenants ?? []).map(async (tenant) => {
      const [intgResult, userResult, lastSyncResult] = await Promise.all([
        auth.supabase
          .from("integrations")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id),
        auth.supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id),
        auth.supabase
          .from("integrations")
          .select("last_synced_at")
          .eq("tenant_id", tenant.id)
          .not("last_synced_at", "is", null)
          .order("last_synced_at", { ascending: false })
          .limit(1),
      ]);

      return {
        ...tenant,
        integrationCount: intgResult.count ?? 0,
        userCount: userResult.count ?? 0,
        lastSyncedAt: lastSyncResult.data?.[0]?.last_synced_at ?? null,
      };
    })
  );

  return NextResponse.json({ data: enriched, error: null });
}

// POST /api/clients — create a new client
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  try {
    const body = await req.json();
    const input = createTenantSchema.parse(body);

    const { data, error } = await auth.supabase
      .from("tenants")
      .insert({ name: input.name, slug: input.slug })
      .select()
      .single();

    if (error) {
      const status = error.code === "23505" ? 409 : 500;
      return NextResponse.json(
        { data: null, error: error.message },
        { status }
      );
    }

    return NextResponse.json({ data, error: null }, { status: 201 });
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
