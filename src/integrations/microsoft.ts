import type { IntegrationAdapter, NormalizedUser } from "@/types";

/**
 * Microsoft Graph adapter – fetches users via the Microsoft Graph API.
 *
 * Authentication: OAuth 2.0 Client Credentials flow.
 *   - apiKey   = client_secret
 *   - extraConfig.clientId   = Application (client) ID
 *   - extraConfig.tenantId   = Azure AD tenant ID (directory ID)
 *
 * The adapter exchanges these for a bearer token, then pages through
 * /users with $select to pull identity fields.
 */

interface GraphUser {
  id: string;
  mail?: string | null;
  userPrincipalName: string;
  displayName?: string | null;
  accountEnabled?: boolean;
  assignedLicenses?: { skuId: string }[];
  signInActivity?: { lastSignInDateTime?: string | null };
  [key: string]: unknown;
}

interface GraphListResponse {
  value: GraphUser[];
  "@odata.nextLink"?: string;
}

const TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token";
const GRAPH_USERS_URL = "https://graph.microsoft.com/v1.0/users";
const PAGE_SIZE = 100;

export class MicrosoftAdapter implements IntegrationAdapter {
  readonly appName = "Microsoft";

  async fetchUsers(
    apiKey: string,
    _baseUrl?: string,
    extraConfig: Record<string, unknown> = {}
  ): Promise<NormalizedUser[]> {
    const clientId = extraConfig.clientId;
    const tenantId = extraConfig.tenantId;

    if (typeof clientId !== "string" || !clientId) {
      throw new Error("Microsoft integration requires a Client ID (extraConfig.clientId)");
    }
    if (typeof tenantId !== "string" || !tenantId) {
      throw new Error("Microsoft integration requires a Tenant ID (extraConfig.tenantId)");
    }

    // 1. Acquire access token via client credentials grant
    const tokenEndpoint = TOKEN_URL.replace("{tenant}", tenantId);
    const tokenRes = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: apiKey,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      throw new Error(`Microsoft token error ${tokenRes.status}: ${body.slice(0, 300)}`);
    }

    const tokenData = (await tokenRes.json()) as { access_token: string };
    const accessToken = tokenData.access_token;

    // 2. Page through /users
    const allUsers: NormalizedUser[] = [];
    let nextUrl: string | undefined =
      `${GRAPH_USERS_URL}?$top=${PAGE_SIZE}&$select=id,mail,userPrincipalName,displayName,accountEnabled,assignedLicenses`;

    while (nextUrl) {
      const res = await fetch(nextUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Microsoft Graph API error ${res.status}: ${body.slice(0, 300)}`);
      }

      const data = (await res.json()) as GraphListResponse;

      for (const u of data.value) {
        allUsers.push({
          externalId: u.id,
          email: u.mail ?? u.userPrincipalName ?? "",
          displayName: u.displayName ?? null,
          licenseType:
            u.assignedLicenses && u.assignedLicenses.length > 0
              ? `${u.assignedLicenses.length} license(s)`
              : null,
          isActive: u.accountEnabled !== false,
          lastSeenAt: u.signInActivity?.lastSignInDateTime ?? null,
        });
      }

      nextUrl = data["@odata.nextLink"];
    }

    return allUsers;
  }
}
