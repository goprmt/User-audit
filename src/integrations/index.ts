import type { IntegrationAdapter } from "@/types";
import { JumpCloudAdapter } from "./jumpcloud";

const adapters: Record<string, IntegrationAdapter> = {};

function register(adapter: IntegrationAdapter): void {
  adapters[adapter.appName.toLowerCase()] = adapter;
}

// ── Built-in adapters ──────────────────────────────────────
register(new JumpCloudAdapter());

// ── Public API ─────────────────────────────────────────────

export function getAdapter(appName: string): IntegrationAdapter | undefined {
  return adapters[appName.toLowerCase()];
}

export function listAdapterNames(): string[] {
  return Object.keys(adapters);
}
