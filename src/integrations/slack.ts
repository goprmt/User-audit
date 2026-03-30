import type { IntegrationAdapter, NormalizedUser } from "@/types";

/**
 * Slack adapter — fetches workspace members via the Slack Web API.
 *
 * Supports two authentication modes (extraConfig.authMethod):
 *
 * 1. "bot_token" — static bot/user token used directly as a Bearer token.
 *    - apiKey = the token itself (e.g. xoxb-… or xoxp-…)
 *    - No rotation; extraConfig.clientId is not required.
 *
 * 2. "refresh_token" (default) — OAuth2 with token rotation.
 *    - apiKey = JSON string: { "refreshToken": "...", "clientSecret": "..." }
 *    - extraConfig.clientId = Slack app client ID
 *    - Each exchange returns a new refresh_token, persisted via
 *      getUpdatedApiKey().
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

    const authMethod = extraConfig.authMethod ?? "refresh_token";
    const accessToken =
      authMethod === "bot_token"
        ? apiKey
        : await this.exchangeRefreshToken(apiKey, extraConfig);

    return this.listUsers(accessToken);
  }

  private async exchangeRefreshToken(
    apiKey: string,
    extraConfig: Record<string, unknown>
  ): Promise<string> {
    const clientId = extraConfig.clientId;
    if (typeof clientId !== "string" || !clientId) {
      throw new Error(
        "Slack OAuth integration requires a client ID (extraConfig.clientId)"
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

    if (tokenData.refresh_token) {
      this._updatedApiKey = JSON.stringify({
        refreshToken: tokenData.refresh_token,
        clientSecret: secrets.clientSecret,
      });
    }

    return tokenData.access_token;
  }

  private async listUsers(accessToken: string): Promise<NormalizedUser[]> {
    const allUsers: NormalizedUser[] = [];
    let cursor: string | undefined;
    let totalMembers = 0;
    let humanMembers = 0;
    let missingEmail = 0;

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
        totalMembers++;
        if (m.is_bot || m.is_app_user || m.id === "USLACKBOT") continue;
        if (m.deleted) continue;
        humanMembers++;

        const email = m.profile?.email;
        if (!email) {
          missingEmail++;
          continue;
        }

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
          createdAt: null, // Slack users.list does not expose account creation date
        });
      }

      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);

    if (allUsers.length === 0 && humanMembers > 0 && missingEmail === humanMembers) {
      throw new Error(
        `Slack returned ${totalMembers} members but none had an email address. ` +
        "Add the users:read.email scope to your Slack app/token and try again."
      );
    }

    return allUsers;
  }
}
