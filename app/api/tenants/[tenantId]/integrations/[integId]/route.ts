import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { updateIntegrationSchema } from "@/lib/validation";
import { encrypt } from "@/lib/crypto";
import { ZodError } from "zod";

interface RouteParams {
  params: Promise<{ tenantId: string; integId: string }>;
}

// PUT /api/tenants/[tenantId]/integrations/[integId]
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId, integId } = await params;

  try {
    const body = await req.json();
    const input = updateIntegrationSchema.parse(body);

    // Verify ownership
    const { data: existing } = await auth.supabase
      .from("integrations")
      .select("id")
      .eq("id", integId)
      .eq("tenant_id", tenantId)
      .single();

    if (!existing) {
      return NextResponse.json(
        { data: null, error: "Integration not found" },
        { status: 404 }
      );
    }

    // Build update payload
    const updates: Record<string, unknown> = {};
    if (input.apiKey) updates.api_key_encrypted = encrypt(input.apiKey);
    if (input.syncFrequency) updates.sync_frequency = input.syncFrequency;
    if (input.status) updates.status = input.status;
    if (input.extraConfig) updates.extra_config = input.extraConfig;
    if (input.baseUrl) {
      // Merge baseUrl into extra_config
      const { data: current } = await auth.supabase
        .from("integrations")
        .select("extra_config")
        .eq("id", integId)
        .single();
      updates.extra_config = {
        ...((current?.extra_config as Record<string, unknown>) ?? {}),
        baseUrl: input.baseUrl,
      };
    }

    const { data, error } = await auth.supabase
      .from("integrations")
      .update(updates)
      .eq("id", integId)
      .select(
        "id, app_name, status, sync_frequency, last_synced_at, extra_config, updated_at"
      )
      .single();

    if (error) {
      return NextResponse.json(
        { data: null, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ data, error: null });
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

// DELETE /api/tenants/[tenantId]/integrations/[integId]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId, integId } = await params;

  // Verify ownership
  const { data: existing } = await auth.supabase
    .from("integrations")
    .select("id")
    .eq("id", integId)
    .eq("tenant_id", tenantId)
    .single();

  if (!existing) {
    return NextResponse.json(
      { data: null, error: "Integration not found" },
      { status: 404 }
    );
  }

  const { error } = await auth.supabase
    .from("integrations")
    .delete()
    .eq("id", integId);

  if (error) {
    return NextResponse.json(
      { data: null, error: error.message },
      { status: 500 }
    );
  }

  return new NextResponse(null, { status: 204 });
}
