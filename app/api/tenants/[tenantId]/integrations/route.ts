import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { createIntegrationSchema } from "@/lib/validation";
import { encrypt } from "@/lib/crypto";
import { getAdapter } from "@/integrations";
import { ZodError } from "zod";

interface RouteParams {
  params: Promise<{ tenantId: string }>;
}

// GET /api/tenants/[tenantId]/integrations
export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId } = await params;

  const { data, error } = await auth.supabase
    .from("integrations")
    .select(
      "id, app_name, status, sync_frequency, last_synced_at, extra_config, created_at, updated_at"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data, error: null });
}

// POST /api/tenants/[tenantId]/integrations
export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId } = await params;

  try {
    const body = await req.json();
    const input = createIntegrationSchema.parse(body);

    // Check adapter exists
    if (!getAdapter(input.appName)) {
      return NextResponse.json(
        { data: null, error: `Unsupported app: "${input.appName}". Supported: JumpCloud` },
        { status: 400 }
      );
    }

    const extraConfig = {
      ...(input.extraConfig ?? {}),
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    };

    const { data, error } = await auth.supabase
      .from("integrations")
      .insert({
        tenant_id: tenantId,
        app_name: input.appName,
        api_key_encrypted: encrypt(input.apiKey),
        sync_frequency: input.syncFrequency,
        extra_config: extraConfig,
      })
      .select(
        "id, app_name, status, sync_frequency, extra_config, created_at"
      )
      .single();

    if (error) {
      return NextResponse.json(
        { data: null, error: error.message },
        { status: 500 }
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
