/** Normalized user returned by any integration adapter */
export interface NormalizedUser {
  externalId: string;
  email: string;
  displayName: string | null;
  licenseType: string | null;
  isActive: boolean;
  lastSeenAt: string | null; // ISO timestamp
  createdAt?: string | null; // ISO timestamp — maps to external_created_at in DB
  /**
   * Additional email addresses for this user (e.g. Google alias / nonEditableAlias).
   * Sync will upsert these into the user_aliases table automatically.
   */
  aliases?: string[];
}

/** Every integration adapter must implement this */
export interface IntegrationAdapter {
  readonly appName: string;
  fetchUsers(
    apiKey: string,
    baseUrl?: string,
    extraConfig?: Record<string, unknown>
  ): Promise<NormalizedUser[]>;
  /**
   * Adapters that rotate credentials (e.g. Slack's refresh token rotation)
   * should return the updated API key blob after fetchUsers completes.
   * The sync orchestrator will persist the new value to the DB.
   */
  getUpdatedApiKey?(): string | null;
}

/** Consistent API response shape */
export interface ApiResponse<T = unknown> {
  data: T | null;
  error: string | null;
}

/** DB row types (snake_case, matching Supabase) */
export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface IntegrationRow {
  id: string;
  tenant_id: string;
  app_name: string;
  api_key_encrypted: string;
  extra_config: Record<string, unknown>;
  status: "active" | "inactive";
  sync_frequency: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  tenant_id: string;
  integration_id: string;
  email: string;
  display_name: string | null;
  license_type: string | null;
  external_id: string;
  is_active: boolean;
  last_seen_at: string | null;
  synced_at: string;
  created_at: string;
}

export interface SyncLogRow {
  id: string;
  integration_id: string;
  started_at: string;
  completed_at: string | null;
  status: "running" | "success" | "failed";
  user_count: number;
  error_message: string | null;
}
