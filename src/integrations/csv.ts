import type { IntegrationAdapter, NormalizedUser } from "@/types";

/**
 * The CSV adapter is a special no-op adapter.
 * Users are loaded via the dedicated /csv/upload route, not via a live API call.
 * Returning an empty array ensures the stale-cleanup logic in sync.ts never fires
 * (upsertedCount stays 0, so no existing rows are deleted).
 */
export class CsvAdapter implements IntegrationAdapter {
  readonly appName = "CSV";

  async fetchUsers(): Promise<NormalizedUser[]> {
    return [];
  }
}
