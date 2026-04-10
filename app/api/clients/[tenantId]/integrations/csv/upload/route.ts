import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { csvUploadSchema } from "@/lib/validation";
import { ZodError } from "zod";

interface RouteParams {
  params: Promise<{ tenantId: string }>;
}

/**
 * POST /api/clients/[tenantId]/integrations/csv/upload
 *
 * Body: { integrationId: string; users: CsvUserInput[] }
 *
 * Replaces all existing users for this CSV integration with the uploaded dataset.
 * Also creates a sync_log entry so the sync history tab shows the upload.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId } = await params;

  try {
    const body = await req.json();
    const { integrationId, users } = csvUploadSchema.parse(body);

    // Verify the integration belongs to this tenant and is a CSV type
    const { data: integration, error: integErr } = await auth.supabase
      .from("integrations")
      .select("id, app_name, tenant_id")
      .eq("id", integrationId)
      .eq("tenant_id", tenantId)
      .single();

    if (integErr || !integration) {
      return NextResponse.json(
        { data: null, error: "Integration not found" },
        { status: 404 }
      );
    }

    if (integration.app_name.toLowerCase() !== "csv") {
      return NextResponse.json(
        { data: null, error: "This endpoint is only for CSV integrations" },
        { status: 400 }
      );
    }

    // Create a running sync log entry
    const { data: logRow } = await auth.supabase
      .from("sync_logs")
      .insert({ integration_id: integrationId, status: "running" })
      .select("id")
      .single();
    const logId: string | undefined = logRow?.id;

    const now = new Date().toISOString();
    let upsertedCount = 0;

    for (const u of users) {
      // Use email as externalId fallback so duplicate emails are deduplicated
      const externalId = u.externalId?.trim() || u.email.toLowerCase();

      const row: Record<string, unknown> = {
        tenant_id: tenantId,
        integration_id: integrationId,
        external_id: externalId,
        email: u.email.toLowerCase(),
        display_name: u.displayName ?? null,
        license_type: u.licenseType ?? null,
        is_active: u.isActive ?? true,
        last_seen_at: u.lastSeenAt ?? null,
        synced_at: now,
      };

      if (u.createdAt !== undefined) {
        row.external_created_at = u.createdAt ?? null;
      }

      const { error: upsertErr } = await auth.supabase
        .from("users")
        .upsert(row, { onConflict: "integration_id,external_id" });

      if (!upsertErr) upsertedCount++;
    }

    // Remove rows that existed before this upload (stale records)
    if (upsertedCount > 0) {
      await auth.supabase
        .from("users")
        .delete()
        .eq("integration_id", integrationId)
        .lt("synced_at", now);
    }

    // Update integration last_synced_at
    await auth.supabase
      .from("integrations")
      .update({ last_synced_at: now })
      .eq("id", integrationId);

    // Mark log as success
    if (logId) {
      await auth.supabase
        .from("sync_logs")
        .update({
          status: "success",
          completed_at: now,
          user_count: users.length,
        })
        .eq("id", logId);
    }

    return NextResponse.json({
      data: {
        integrationId,
        userCount: upsertedCount,
        total: users.length,
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
