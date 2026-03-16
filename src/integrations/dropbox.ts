import type { IntegrationAdapter, NormalizedUser } from "@/types";

/**
 * Dropbox Business adapter — fetches team members via the Dropbox Business API.
 *
 * Authentication: OAuth2 refresh token flow.
 *   - apiKey = JSON string: { "refreshToken": "...", "secret": "..." }
 *     (both stored encrypted in the DB)
 *   - extraConfig.key = Dropbox app key
 *
 * On each sync the adapter exchanges the refresh token for a short-lived
 * access token, then pages through the team/members/list_v2 endpoint.
 */

interface DropboxMember {
  profile: {
    team_member_id: string;
    email: string;
    name?: { display_name?: string };
    status: { ".tag": string };
    membership_type?: { ".tag": string };
    joined_on?: string;
  };
}

interface DropboxListResponse {
  members: DropboxMember[];
  cursor?: string;
  has_more: boolean;
}

interface DropboxSecrets {
  refreshToken: string;
  secret: string;
}

const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const DROPBOX_MEMBERS_LIST_URL =
  "https://api.dropboxapi.com/2/team/members/list_v2";
const DROPBOX_MEMBERS_CONTINUE_URL =
  "https://api.dropboxapi.com/2/team/members/list/continue_v2";

export class DropboxAdapter implements IntegrationAdapter {
  readonly appName = "Dropbox";

  async fetchUsers(
    apiKey: string,
    _baseUrl?: string,
    extraConfig: Record<string, unknown> = {}
  ): Promise<NormalizedUser[]> {
    const appKey = extraConfig.key;
    if (typeof appKey !== "string" || !appKey) {
      throw new Error(
        "Dropbox integration requires an app key (extraConfig.key)"
      );
    }

    let secrets: DropboxSecrets;
    try {
      secrets = JSON.parse(apiKey) as DropboxSecrets;
    } catch {
      throw new Error("Dropbox integration: could not parse stored credentials");
    }

    if (!secrets.refreshToken || !secrets.secret) {
      throw new Error(
        "Dropbox integration: missing refreshToken or secret in stored credentials"
      );
    }

    // Exchange refresh token for an access token
    const tokenRes = await fetch(DROPBOX_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: secrets.refreshToken,
        client_id: appKey,
        client_secret: secrets.secret,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      throw new Error(
        `Dropbox token error ${tokenRes.status}: ${body.slice(0, 300)}`
      );
    }

    const tokenData = (await tokenRes.json()) as { access_token: string };
    const accessToken = tokenData.access_token;

    // Page through team members
    const allUsers: NormalizedUser[] = [];
    let hasMore = true;
    let cursor: string | undefined;

    while (hasMore) {
      const url = cursor
        ? DROPBOX_MEMBERS_CONTINUE_URL
        : DROPBOX_MEMBERS_LIST_URL;
      const body = cursor ? { cursor } : { limit: 100 };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(
          `Dropbox members API error ${res.status}: ${errBody.slice(0, 300)}`
        );
      }

      const data = (await res.json()) as DropboxListResponse;

      for (const m of data.members ?? []) {
        const p = m.profile;
        const statusTag = p.status?.[".tag"] ?? "";
        const isActive = statusTag === "active" || statusTag === "invited";

        allUsers.push({
          externalId: p.team_member_id,
          email: p.email ?? "",
          displayName: p.name?.display_name ?? null,
          licenseType: p.membership_type?.[".tag"] ?? null,
          isActive,
          lastSeenAt: null,
        });
      }

      hasMore = data.has_more;
      cursor = data.cursor;
    }

    return allUsers;
  }
}
