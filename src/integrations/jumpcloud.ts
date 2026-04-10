import type { IntegrationAdapter, NormalizedUser } from "@/types";

interface JumpCloudSystemUser {
  _id: string;
  email: string;
  username?: string;
  displayname?: string;
  employeeType?: string;
  account_locked?: boolean;
  suspended?: boolean;
  state?: string;
  created?: string;
  [key: string]: unknown;
}

interface JumpCloudListResponse {
  totalCount: number;
  results: JumpCloudSystemUser[];
}

interface InsightsEvent {
  event_type?: string;
  timestamp?: string;
  initiated_by?: {
    id?: string;
    username?: string;
    type?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const DEFAULT_BASE_URL = "https://console.jumpcloud.com";
const INSIGHTS_URL = "https://api.jumpcloud.com/insights/directory/v1/events";
const PAGE_SIZE = 100;

export class JumpCloudAdapter implements IntegrationAdapter {
  readonly appName = "JumpCloud";

  async fetchUsers(
    apiKey: string,
    baseUrl: string = DEFAULT_BASE_URL,
    extraConfig: Record<string, unknown> = {}
  ): Promise<NormalizedUser[]> {
    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const orgId = extraConfig.orgId;
    if (typeof orgId === "string" && orgId.length > 0) {
      headers["x-org-id"] = orgId;
    }

    // 1. Fetch all system users
    const allRawUsers: JumpCloudSystemUser[] = [];
    let skip = 0;
    let total = Infinity;

    while (skip < total) {
      const url = `${baseUrl}/api/systemusers?limit=${PAGE_SIZE}&skip=${skip}`;

      const res = await fetch(url, { method: "GET", headers });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `JumpCloud API error ${res.status}: ${body.slice(0, 300)}`
        );
      }

      const data = (await res.json()) as JumpCloudListResponse;
      total = data.totalCount;
      allRawUsers.push(...data.results);
      skip += PAGE_SIZE;
    }

    // 2. Fetch last login timestamps from Directory Insights
    const lastLoginMap = await this.fetchLastLogins(headers);

    // 3. Build normalized user list
    const allUsers: NormalizedUser[] = [];
    for (const u of allRawUsers) {
      allUsers.push({
        externalId: u._id,
        email: u.email ?? "",
        displayName: u.username ?? u.displayname ?? null,
        licenseType: u.employeeType ?? null,
        isActive: !(u.account_locked || u.suspended),
        lastSeenAt: lastLoginMap.get(u._id) ?? null,
      });
    }

    return allUsers;
  }

  /**
   * Queries the JumpCloud Directory Insights API for the most recent
   * authentication event per user within the last 90 days.
   */
  private async fetchLastLogins(
    headers: Record<string, string>
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    try {
      let searchAfter: unknown[] | undefined;
      let hasMore = true;
      let pages = 0;
      const MAX_PAGES = 5;

      while (hasMore && pages < MAX_PAGES) {
        pages++;

        const body: Record<string, unknown> = {
          service: ["all"],
          start_time: ninetyDaysAgo.toISOString(),
          sort: "DESC",
          limit: 10000,
          search_term: {
            or: [
              { event_type: "sso_auth" },
              { event_type: "user_login_attempt" },
            ],
          },
        };

        if (searchAfter) {
          body.search_after = searchAfter;
        }

        const res = await fetch(INSIGHTS_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });

        if (!res.ok) break;

        const events = (await res.json()) as InsightsEvent[];
        if (!Array.isArray(events) || events.length === 0) break;

        for (const evt of events) {
          const userId = evt.initiated_by?.id;
          const timestamp = evt.timestamp;

          // Sorted DESC, so first occurrence per user is their most recent login
          if (userId && timestamp && !map.has(userId)) {
            map.set(userId, timestamp);
          }
        }

        // Pagination: check X-Result-Count vs X-Limit
        const resultCount = parseInt(
          res.headers.get("X-Result-Count") ?? "0",
          10
        );
        const limit = parseInt(res.headers.get("X-Limit") ?? "10000", 10);

        if (resultCount < limit) {
          hasMore = false;
        } else {
          const nextCursor = res.headers.get("X-Search_after");
          if (nextCursor) {
            try {
              searchAfter = JSON.parse(nextCursor);
            } catch {
              hasMore = false;
            }
          } else {
            hasMore = false;
          }
        }
      }
    } catch {
      // Non-fatal — users will show no last login data
    }

    return map;
  }
}
