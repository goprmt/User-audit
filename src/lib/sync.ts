import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdapter } from "@/integrations";
import { decrypt, encrypt } from "@/lib/crypto";
import type { IntegrationRow, NormalizedUser } from "@/types";

export interface SyncResult {
  integrationId: string;
  userCount: number;
  status: "success" | "failed";
  error?: string;
}

/**
 * Run a full sync for one integration.
 * - Fetches users from the external service
 * - Upserts them into the `users` table
 * - Logs the result to `sync_logs`
 */
export async function runSync(
  supabase: SupabaseClient,
  integration: IntegrationRow
): Promise<SyncResult> {
  // Create a "running" log entry
  const { data: logRow } = await supabase
    .from("sync_logs")
    .insert({ integration_id: integration.id, status: "running" })
    .select("id")
    .single();

  const logId: string | undefined = logRow?.id;

  try {
    const adapter = getAdapter(integration.app_name);
    if (!adapter) {
      throw new Error(`No adapter for app: ${integration.app_name}`);
    }

    const apiKey = decrypt(integration.api_key_encrypted);
    const extraConfig = integration.extra_config ?? {};
    const baseUrl =
      (extraConfig as Record<string, string>)?.baseUrl ?? undefined;
    const users: NormalizedUser[] = await adapter.fetchUsers(apiKey, baseUrl, extraConfig);

    // If the adapter rotated credentials (e.g. Slack), persist the new value
    if (adapter.getUpdatedApiKey) {
      const newApiKey = adapter.getUpdatedApiKey();
      if (newApiKey) {
        await supabase
          .from("integrations")
          .update({ api_key_encrypted: encrypt(newApiKey) })
          .eq("id", integration.id);
      }
    }

    // Upsert users (conflict on integration_id + external_id)
    const now = new Date().toISOString();
    for (const u of users) {
      await supabase.from("users").upsert(
        {
          tenant_id: integration.tenant_id,
          integration_id: integration.id,
          external_id: u.externalId,
          email: u.email,
          display_name: u.displayName,
          license_type: u.licenseType,
          is_active: u.isActive,
          last_seen_at: u.lastSeenAt,
          external_created_at: u.createdAt,
          synced_at: now,
        },
        { onConflict: "integration_id,external_id" }
      );
    }

    // Remove stale users no longer returned by the adapter (e.g. unlicensed
    // Microsoft users that were synced previously but are now filtered out).
    await supabase
      .from("users")
      .delete()
      .eq("integration_id", integration.id)
      .lt("synced_at", now);

    // Update integration last_synced_at
    await supabase
      .from("integrations")
      .update({ last_synced_at: now })
      .eq("id", integration.id);

    // Mark log as success
    if (logId) {
      await supabase
        .from("sync_logs")
        .update({
          status: "success",
          completed_at: now,
          user_count: users.length,
        })
        .eq("id", logId);
    }

    return {
      integrationId: integration.id,
      userCount: users.length,
      status: "success",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const now = new Date().toISOString();

    if (logId) {
      await supabase
        .from("sync_logs")
        .update({
          status: "failed",
          completed_at: now,
          error_message: message.slice(0, 2000),
        })
        .eq("id", logId);
    }

    return {
      integrationId: integration.id,
      userCount: 0,
      status: "failed",
      error: message,
    };
  }
}
