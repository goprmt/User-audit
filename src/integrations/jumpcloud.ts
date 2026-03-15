import type { IntegrationAdapter, NormalizedUser } from "@/types";

interface JumpCloudSystemUser {
  _id: string;
  email: string;
  displayname?: string;
  account_locked?: boolean;
  suspended?: boolean;
  created?: string;
  [key: string]: unknown;
}

interface JumpCloudListResponse {
  totalCount: number;
  results: JumpCloudSystemUser[];
}

const DEFAULT_BASE_URL = "https://console.jumpcloud.com";
const PAGE_SIZE = 100;

export class JumpCloudAdapter implements IntegrationAdapter {
  readonly appName = "JumpCloud";

  async fetchUsers(
    apiKey: string,
    baseUrl: string = DEFAULT_BASE_URL,
    extraConfig: Record<string, unknown> = {}
  ): Promise<NormalizedUser[]> {
    const allUsers: NormalizedUser[] = [];
    let skip = 0;
    let total = Infinity;

    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const orgId = extraConfig.orgId;
    if (typeof orgId === "string" && orgId.length > 0) {
      headers["x-org-id"] = orgId;
    }

    while (skip < total) {
      const url = `${baseUrl}/api/systemusers?limit=${PAGE_SIZE}&skip=${skip}`;

      const res = await fetch(url, {
        method: "GET",
        headers,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `JumpCloud API error ${res.status}: ${body.slice(0, 300)}`
        );
      }

      const data = (await res.json()) as JumpCloudListResponse;
      total = data.totalCount;

      for (const u of data.results) {
        allUsers.push({
          externalId: u._id,
          email: u.email ?? "",
          displayName: u.displayname ?? null,
          licenseType: null,
          isActive: !(u.account_locked || u.suspended),
          lastSeenAt: u.created ?? null,
        });
      }

      skip += PAGE_SIZE;
    }

    return allUsers;
  }
}
