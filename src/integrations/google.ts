import type { IntegrationAdapter, NormalizedUser } from "@/types";

/**
 * Google Workspace adapter — fetches users via the Google Admin Directory API.
 *
 * Authentication: OAuth2 refresh token flow.
 *   - apiKey = JSON string: { "refreshToken": "...", "clientSecret": "..." }
 *     (both stored encrypted in the DB)
 *   - extraConfig.clientId  = OAuth2 client ID
 *   - extraConfig.domain    = Google Workspace primary domain
 *
 * On each sync the adapter exchanges the refresh token for a short-lived
 * access token, then pages through the Directory API /users endpoint.
 */

interface GoogleUser {
  id: string;
  primaryEmail: string;
  name?: { fullName?: string };
  suspended?: boolean;
  isAdmin?: boolean;
  lastLoginTime?: string;
  creationTime?: string;
  isEnrolledIn2Sv?: boolean;
  /** Domain-managed alias addresses */
  aliases?: string[];
  /** External (non-editable) alias addresses, e.g. legacy Google Apps addresses */
  nonEditableAliases?: string[];
  [key: string]: unknown;
}

interface GoogleListResponse {
  users?: GoogleUser[];
  nextPageToken?: string;
}

interface GoogleSecrets {
  refreshToken: string;
  clientSecret: string;
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DIRECTORY_USERS_URL =
  "https://admin.googleapis.com/admin/directory/v1/users";
const PAGE_SIZE = 100;

export class GoogleAdapter implements IntegrationAdapter {
  readonly appName = "Google";

  async fetchUsers(
    apiKey: string,
    _baseUrl?: string,
    extraConfig: Record<string, unknown> = {}
  ): Promise<NormalizedUser[]> {
    const domain = extraConfig.domain;
    if (typeof domain !== "string" || !domain) {
      throw new Error("Google integration requires a domain (extraConfig.domain)");
    }

    const clientId = extraConfig.clientId;
    if (typeof clientId !== "string" || !clientId) {
      throw new Error("Google integration requires a client ID (extraConfig.clientId)");
    }

    let secrets: GoogleSecrets;
    try {
      secrets = JSON.parse(apiKey) as GoogleSecrets;
    } catch {
      throw new Error(
        "Google integration: could not parse stored credentials"
      );
    }

    if (!secrets.refreshToken || !secrets.clientSecret) {
      throw new Error(
        "Google integration: missing refreshToken or clientSecret in stored credentials"
      );
    }

    // Exchange refresh token for an access token
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
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
      throw new Error(`Google token error ${tokenRes.status}: ${body.slice(0, 300)}`);
    }

    const tokenData = (await tokenRes.json()) as { access_token: string };
    const accessToken = tokenData.access_token;

    // Page through Directory API /users
    const allUsers: NormalizedUser[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        domain,
        maxResults: String(PAGE_SIZE),
        projection: "full",
        orderBy: "email",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const url = `${DIRECTORY_USERS_URL}?${params}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `Google Directory API error ${res.status}: ${body.slice(0, 300)}`
        );
      }

      const data = (await res.json()) as GoogleListResponse;

      for (const u of data.users ?? []) {
        // Collect all non-primary email addresses for this user.
        // `aliases` = domain-managed aliases; `nonEditableAliases` = external/legacy ones.
        const primaryLower = (u.primaryEmail ?? "").toLowerCase();
        const aliases = [
          ...(u.aliases ?? []),
          ...(u.nonEditableAliases ?? []),
        ]
          .map(a => a.toLowerCase())
          .filter(a => a && a !== primaryLower);

        allUsers.push({
          externalId: u.id,
          email: u.primaryEmail ?? "",
          displayName: u.name?.fullName ?? null,
          licenseType: u.isAdmin ? "Admin" : null,
          isActive: !u.suspended,
          lastSeenAt: u.lastLoginTime ?? null,
          createdAt: u.creationTime ?? null,
          aliases: aliases.length > 0 ? aliases : undefined,
        });
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    return allUsers;
  }
}
