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
 * Last-active timestamps are derived from the team_log/get_events endpoint
 * filtered to login events.
 *
 * Required Dropbox app scopes:
 *   - members.read       (team member listing)
 *   - events.read        (team activity / audit log)
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

interface DropboxEventActor {
  ".tag"?: string;
  user?: { email?: string; team_member_id?: string };
}

interface DropboxEvent {
  timestamp?: string;
  actor?: DropboxEventActor;
  event_type?: { ".tag"?: string };
}

interface DropboxEventsResponse {
  events: DropboxEvent[];
  cursor?: string;
  has_more: boolean;
}

const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const DROPBOX_MEMBERS_LIST_URL =
  "https://api.dropboxapi.com/2/team/members/list_v2";
const DROPBOX_MEMBERS_CONTINUE_URL =
  "https://api.dropboxapi.com/2/team/members/list/continue_v2";
const DROPBOX_EVENTS_URL =
  "https://api.dropboxapi.com/2/team_log/get_events";
const DROPBOX_EVENTS_CONTINUE_URL =
  "https://api.dropboxapi.com/2/team_log/get_events/continue";

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

    // Fetch members and login events in parallel
    const [allUsers, lastLoginByMemberId] = await Promise.all([
      this.fetchMembers(accessToken),
      this.fetchLastLogins(accessToken),
    ]);

    for (const u of allUsers) {
      u.lastSeenAt = lastLoginByMemberId.get(u.externalId) ?? null;
    }

    return allUsers;
  }

  private async fetchMembers(
    accessToken: string
  ): Promise<NormalizedUser[]> {
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
          createdAt: p.joined_on ?? null,
        });
      }

      hasMore = data.has_more;
      cursor = data.cursor;
    }

    return allUsers;
  }

  /**
   * Pages through team_log/get_events filtered to logins and builds a map
   * of team_member_id → most recent login ISO timestamp.
   */
  private async fetchLastLogins(
    accessToken: string
  ): Promise<Map<string, string>> {
    const lastLogin = new Map<string, string>();

    try {
      let hasMore = true;
      let cursor: string | undefined;

      while (hasMore) {
        const url = cursor ? DROPBOX_EVENTS_CONTINUE_URL : DROPBOX_EVENTS_URL;
        const body = cursor
          ? { cursor }
          : { limit: 1000, category: "logins" };

        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) break;

        const data = (await res.json()) as DropboxEventsResponse;

        for (const evt of data.events ?? []) {
          const tag = evt.event_type?.[".tag"] ?? "";
          if (tag !== "login_success") continue;

          const memberId = evt.actor?.user?.team_member_id;
          const ts = evt.timestamp;
          if (!memberId || !ts) continue;

          const existing = lastLogin.get(memberId);
          if (!existing || ts > existing) {
            lastLogin.set(memberId, ts);
          }
        }

        hasMore = data.has_more;
        cursor = data.cursor;
      }
    } catch {
      // Non-fatal — we still return members even without last-login data
    }

    return lastLogin;
  }
}
