import type { IntegrationAdapter, NormalizedUser } from "@/types";

/**
 * Slack adapter — fetches workspace members via the Slack Web API.
 *
 * Authentication: OAuth2 with token rotation.
 *   - apiKey = JSON string: { "refreshToken": "...", "clientSecret": "..." }
 *     (both stored encrypted in the DB)
 *   - extraConfig.clientId = Slack app client ID
 *
 * Slack's token rotation means every access_token exchange also returns a
 * new refresh_token. The adapter exposes the rotated credentials via
 * getUpdatedApiKey() so the sync orchestrator can persist them.
 */

interface SlackMember {
  id: string;
  name: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  profile?: {
    email?: string;
    display_name?: string;
    real_name?: string;
  };
  updated?: number;
}

interface SlackListResponse {
  ok: boolean;
  members?: SlackMember[];
  response_metadata?: { next_cursor?: string };
  error?: string;
}

interface SlackSecrets {
  refreshToken: string;
  clientSecret: string;
}

const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";
const SLACK_USERS_LIST_URL = "https://slack.com/api/users.list";

export class SlackAdapter implements IntegrationAdapter {
  readonly appName = "Slack";

  private _updatedApiKey: string | null = null;

  getUpdatedApiKey(): string | null {
    return this._updatedApiKey;
  }

  async fetchUsers(
    apiKey: string,
    _baseUrl?: string,
    extraConfig: Record<string, unknown> = {}
  ): Promise<NormalizedUser[]> {
    this._updatedApiKey = null;

    const clientId = extraConfig.clientId;
    if (typeof clientId !== "string" || !clientId) {
      throw new Error(
        "Slack integration requires a client ID (extraConfig.clientId)"
      );
    }

    let secrets: SlackSecrets;
    try {
      secrets = JSON.parse(apiKey) as SlackSecrets;
    } catch {
      throw new Error("Slack integration: could not parse stored credentials");
    }

    if (!secrets.refreshToken || !secrets.clientSecret) {
      throw new Error(
        "Slack integration: missing refreshToken or clientSecret in stored credentials"
      );
    }

    // Exchange refresh token — Slack returns a NEW refresh_token each time
    const tokenRes = await fetch(SLACK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: secrets.clientSecret,
        grant_type: "refresh_token",
        refresh_token: secrets.refreshToken,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      throw new Error(
        `Slack token error ${tokenRes.status}: ${body.slice(0, 300)}`
      );
    }

    const tokenData = (await tokenRes.json()) as {
      ok: boolean;
      access_token?: string;
      refresh_token?: string;
      error?: string;
    };

    if (!tokenData.ok || !tokenData.access_token) {
      throw new Error(
        `Slack token exchange failed: ${tokenData.error ?? "unknown error"}`
      );
    }

    const accessToken = tokenData.access_token;

    // Persist the rotated refresh token so the sync orchestrator can save it
    if (tokenData.refresh_token) {
      this._updatedApiKey = JSON.stringify({
        refreshToken: tokenData.refresh_token,
        clientSecret: secrets.clientSecret,
      });
    }

    // Page through users.list
    const allUsers: NormalizedUser[] = [];
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({ limit: "200" });
      if (cursor) params.set("cursor", cursor);

      const res = await fetch(`${SLACK_USERS_LIST_URL}?${params}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `Slack users.list error ${res.status}: ${body.slice(0, 300)}`
        );
      }

      const data = (await res.json()) as SlackListResponse;

      if (!data.ok) {
        throw new Error(
          `Slack users.list failed: ${data.error ?? "unknown error"}`
        );
      }

      for (const m of data.members ?? []) {
        if (m.is_bot || m.is_app_user || m.id === "USLACKBOT") continue;
        if (m.deleted) continue;

        const email = m.profile?.email;
        if (!email) continue;

        const lastSeen = m.updated
          ? new Date(m.updated * 1000).toISOString()
          : null;

        allUsers.push({
          externalId: m.id,
          email,
          displayName:
            m.profile?.real_name ?? m.real_name ?? m.name ?? null,
          licenseType: null,
          isActive: true,
          lastSeenAt: lastSeen,
        });
      }

      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);

    return allUsers;
  }
}
