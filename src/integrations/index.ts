import type { IntegrationAdapter } from "@/types";
import { JumpCloudAdapter } from "./jumpcloud";
import { MicrosoftAdapter } from "./microsoft";
import { GoogleAdapter } from "./google";

const adapters: Record<string, IntegrationAdapter> = {};

function register(adapter: IntegrationAdapter): void {
  adapters[adapter.appName.toLowerCase()] = adapter;
}

// â”€â”€ Built-in adapters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
register(new JumpCloudAdapter());
register(new MicrosoftAdapter());
register(new GoogleAdapter());

// â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function getAdapter(appName: string): IntegrationAdapter | undefined {
  return adapters[appName.toLowerCase()];
}

export function listAdapterNames(): string[] {
  return Object.keys(adapters);
}