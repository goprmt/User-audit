import type { IntegrationAdapter, NormalizedUser } from "@/types";

interface HubSpotUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  primaryTeamId?: string;
  superAdmin?: boolean;
  [key: string]: unknown;
}

interface HubSpotListResponse {
  results: HubSpotUser[];
  paging?: { next?: { after?: string } };
}

const USERS_URL = "https://api.hubapi.com/settings/v3/users";
const PAGE_SIZE = 100;

export class HubSpotAdapter implements IntegrationAdapter {
  readonly appName = "HubSpot";

  async fetchUsers(
    apiKey: string,
    _baseUrl?: string,
    extraConfig: Record<string, unknown> = {}
  ): Promise<NormalizedUser[]> {
    const teamLicenseMap = (extraConfig.teamLicenseMap ?? {}) as Record<string, string>;
    const defaultLicense = typeof extraConfig.defaultLicense === "string"
      ? extraConfig.defaultLicense
      : "Unknown";

    const allUsers: NormalizedUser[] = [];
    let after: string | undefined;

    do {
      const url = new URL(USERS_URL);
      url.searchParams.set("limit", String(PAGE_SIZE));
      if (after) url.searchParams.set("after", after);

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HubSpot API error ${res.status}: ${body.slice(0, 300)}`);
      }

      const data = (await res.json()) as HubSpotListResponse;

      for (const u of data.results ?? []) {
        const displayName = [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
        const licenseType =
          u.primaryTeamId && teamLicenseMap[u.primaryTeamId]
            ? teamLicenseMap[u.primaryTeamId]
            : defaultLicense;

        allUsers.push({
          externalId: u.id,
          email: u.email ?? "",
          displayName,
          licenseType,
          isActive: true,
          lastSeenAt: null,
        });
      }

      after = data.paging?.next?.after;
    } while (after);

    return allUsers;
  }
}
