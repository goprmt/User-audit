import type { IntegrationAdapter, NormalizedUser } from "@/types";

/**
 * Microsoft Graph adapter — fetches users via the Microsoft Graph API.
 *
 * Authentication: OAuth 2.0 Client Credentials flow.
 *   - apiKey   = client_secret
 *   - extraConfig.clientId   = Application (client) ID
 *   - extraConfig.tenantId   = Azure AD tenant ID (directory ID)
 *
 * The adapter exchanges these for a bearer token, then pages through
 * /users with $select to pull identity fields + signInActivity.
 * It also fetches /subscribedSkus to resolve license GUIDs to names.
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

interface SubscribedSku {
  skuId: string;
  skuPartNumber: string;
  [key: string]: unknown;
}

interface SkuListResponse {
  value: SubscribedSku[];
}

const TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token";
const GRAPH_USERS_URL = "https://graph.microsoft.com/v1.0/users";
const GRAPH_SKUS_URL = "https://graph.microsoft.com/v1.0/subscribedSkus";
const PAGE_SIZE = 100;

/**
 * Maps Microsoft skuPartNumber codes to human-readable names.
 * Falls back to the raw skuPartNumber for anything not listed.
 */
const SKU_FRIENDLY_NAMES: Record<string, string> = {
  ENTERPRISEPACK: "Office 365 E3",
  ENTERPRISEPREMIUM: "Office 365 E5",
  ENTERPRISEPREMIUM_NOPSTNCONF: "Office 365 E5 (no PSTN)",
  SPE_E3: "Microsoft 365 E3",
  SPE_E5: "Microsoft 365 E5",
  SPE_F1: "Microsoft 365 F3",
  M365_F1: "Microsoft 365 F1",
  STANDARDPACK: "Office 365 E1",
  DESKLESSPACK: "Office 365 F3",
  O365_BUSINESS_ESSENTIALS: "Microsoft 365 Business Basic",
  O365_BUSINESS_PREMIUM: "Microsoft 365 Business Standard",
  SMB_BUSINESS: "Microsoft 365 Apps for Business",
  SMB_BUSINESS_PREMIUM: "Microsoft 365 Business Premium",
  EXCHANGESTANDARD: "Exchange Online Plan 1",
  EXCHANGEENTERPRISE: "Exchange Online Plan 2",
  EXCHANGEDESKLESS: "Exchange Online Kiosk",
  ATP_ENTERPRISE: "Defender for Office 365 P1",
  THREAT_INTELLIGENCE: "Defender for Office 365 P2",
  EMS: "Enterprise Mobility + Security E3",
  EMSPREMIUM: "Enterprise Mobility + Security E5",
  AAD_PREMIUM: "Azure AD Premium P1",
  AAD_PREMIUM_P2: "Azure AD Premium P2",
  FLOW_FREE: "Power Automate Free",
  POWER_BI_STANDARD: "Power BI Free",
  POWER_BI_PRO: "Power BI Pro",
  PROJECTPREMIUM: "Project Plan 5",
  PROJECTPROFESSIONAL: "Project Plan 3",
  VISIOCLIENT: "Visio Plan 2",
  TEAMS_EXPLORATORY: "Microsoft Teams Exploratory",
  TEAMS_FREE: "Microsoft Teams Free",
  STREAM: "Microsoft Stream",
  WIN_DEF_ATP: "Defender for Endpoint",
  IDENTITY_THREAT_PROTECTION: "Microsoft 365 E5 Security",
  INFORMATION_PROTECTION_COMPLIANCE: "Microsoft 365 E5 Compliance",
  MEETING_ROOM: "Teams Rooms Standard",
  PHONESYSTEM_VIRTUALUSER: "Phone System Virtual User",
  MCOEV: "Microsoft 365 Phone System",
  MCOPSTN1: "Domestic Calling Plan",
  MCOPSTN2: "Domestic & International Calling Plan",
  RIGHTSMANAGEMENT: "Azure Information Protection P1",
  INTUNE_A: "Microsoft Intune Plan 1",
  Microsoft_365_Copilot: "Microsoft 365 Copilot",
  MICROSOFT_BUSINESS_CENTER: "Microsoft Business Center",
  POWERAPPS_VIRAL: "Power Apps Trial",
  WINDOWS_STORE: "Windows Store for Business",
  ENTERPRISEWITHSCAL: "Office 365 E4",
  DEVELOPERPACK: "Office 365 E3 Developer",
  SPE_E3_USGOV_DOD: "Microsoft 365 E3 (GCC DoD)",
  SPE_E3_USGOV_GCCHIGH: "Microsoft 365 E3 (GCC High)",
  VISIOONLINE_PLAN1: "Visio Plan 1",
  MCOMEETADV: "Microsoft 365 Audio Conferencing",
  COMMUNICATIONS_DLP: "Microsoft Communications DLP",
  CRMSTANDARD: "Dynamics 365 Professional",
  DYN365_ENTERPRISE_PLAN1: "Dynamics 365 Plan",
};

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

    // 2. Fetch subscribedSkus to build skuId → friendly name map
    const skuMap = await this.fetchSkuMap(accessToken);

    // 3. Page through /users — include signInActivity for last login tracking
    const allUsers: NormalizedUser[] = [];
    let nextUrl: string | undefined =
      `${GRAPH_USERS_URL}?$top=${PAGE_SIZE}&$select=id,mail,userPrincipalName,displayName,accountEnabled,assignedLicenses,signInActivity`;

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
        if (!u.assignedLicenses || u.assignedLicenses.length === 0) continue;

        const licenseNames = u.assignedLicenses
          .map((lic) => skuMap.get(lic.skuId) ?? lic.skuId)
          .sort();

        allUsers.push({
          externalId: u.id,
          email: u.mail ?? u.userPrincipalName ?? "",
          displayName: u.displayName ?? null,
          licenseType: licenseNames.join(", "),
          isActive: u.accountEnabled !== false,
          lastSeenAt: u.signInActivity?.lastSignInDateTime ?? null,
        });
      }

      nextUrl = data["@odata.nextLink"];
    }

    return allUsers;
  }

  private async fetchSkuMap(
    accessToken: string
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    try {
      const res = await fetch(GRAPH_SKUS_URL, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (!res.ok) return map;

      const data = (await res.json()) as SkuListResponse;
      for (const sku of data.value) {
        const friendly =
          SKU_FRIENDLY_NAMES[sku.skuPartNumber] ?? sku.skuPartNumber;
        map.set(sku.skuId, friendly);
      }
    } catch {
      // Non-fatal — fall back to showing raw skuId
    }

    return map;
  }
}
