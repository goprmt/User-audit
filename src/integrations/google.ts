import crypto from "crypto";
import type { IntegrationAdapter, NormalizedUser } from "@/types";

/**
 * Google Workspace adapter — fetches users via the Google Admin Directory API.
 *
 * Supports two authentication modes:
 *
 * 1. Bearer token (recommended for quick setup):
 *    - apiKey = an OAuth2 access token
 *    - extraConfig.domain = Workspace primary domain
 *
 * 2. Service Account with domain-wide delegation:
 *    - apiKey = full JSON service account key (stringified)
 *    - extraConfig.domain = Workspace primary domain
 *    - extraConfig.adminEmail = admin email for impersonation
 *
 * The adapter auto-detects which mode to use based on whether apiKey
 * starts with "{" (JSON) or not (bearer token).
 */

interface GoogleUser {
  id: string;
  primaryEmail: string;
  name?: { fullName?: string };
  suspended?: boolean;
  isAdmin?: boolean;
  lastLoginTime?: string;
  isEnrolledIn2Sv?: boolean;
  [key: string]: unknown;
}

interface GoogleListResponse {
  users?: GoogleUser[];
  nextPageToken?: string;
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DIRECTORY_USERS_URL = "https://admin.googleapis.com/admin/directory/v1/users";
const PAGE_SIZE = 100;

function b64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

function createJwt(
  serviceEmail: string,
  privateKeyPem: string,
  adminEmail: string,
  scopes: string[]
): string {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceEmail,
    sub: adminEmail,
    scope: scopes.join(" "),
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const segments = [b64url(JSON.stringify(header)), b64url(JSON.stringify(payload))];
  const signingInput = segments.join(".");

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  const signature = sign.sign(privateKeyPem);

  segments.push(b64url(signature));
  return segments.join(".");
}

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

    const trimmedKey = apiKey.trim();
    const isServiceAccount = trimmedKey.startsWith("{");

    let accessToken: string;

    if (isServiceAccount) {
      accessToken = await this.getServiceAccountToken(trimmedKey, extraConfig);
    } else {
      // Treat apiKey as a direct OAuth2 bearer token
      accessToken = trimmedKey;
    }

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
        throw new Error(`Google Directory API error ${res.status}: ${body.slice(0, 300)}`);
      }

      const data = (await res.json()) as GoogleListResponse;

      for (const u of data.users ?? []) {
        allUsers.push({
          externalId: u.id,
          email: u.primaryEmail ?? "",
          displayName: u.name?.fullName ?? null,
          licenseType: u.isAdmin ? "Admin" : null,
          isActive: !u.suspended,
          lastSeenAt: u.lastLoginTime ?? null,
        });
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    return allUsers;
  }

  private async getServiceAccountToken(
    jsonKey: string,
    extraConfig: Record<string, unknown>
  ): Promise<string> {
    let sa: ServiceAccountKey;
    try {
      sa = JSON.parse(jsonKey) as ServiceAccountKey;
    } catch {
      throw new Error(
        "Google integration: the provided key looks like JSON but could not be parsed"
      );
    }

    if (!sa.client_email || !sa.private_key) {
      throw new Error("Invalid service account key: missing client_email or private_key");
    }

    const adminEmail = extraConfig.adminEmail;
    if (typeof adminEmail !== "string" || !adminEmail) {
      throw new Error(
        "Service account mode requires an admin email for impersonation (extraConfig.adminEmail)"
      );
    }

    const jwt = createJwt(sa.client_email, sa.private_key, adminEmail, [
      "https://www.googleapis.com/auth/admin.directory.user.readonly",
    ]);

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      throw new Error(`Google token error ${tokenRes.status}: ${body.slice(0, 300)}`);
    }

    const tokenData = (await tokenRes.json()) as { access_token: string };
    return tokenData.access_token;
  }
}
