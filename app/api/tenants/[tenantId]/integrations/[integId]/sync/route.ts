import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { checkRateLimit } from "@/lib/ratelimit";
import { runSync } from "@/lib/sync";
import type { IntegrationRow } from "@/types";

interface RouteParams {
  params: Promise<{ tenantId: string; integId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId, integId } = await params;

  // Rate limit: 5 syncs per 15 min per integration
  const rl = checkRateLimit(`sync:${integId}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { data: null, error: "Too many sync requests. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 0) / 1000)) },
      }
    );
  }

  // Fetch integration (scoped by tenantId)
  const { data: integration, error: fetchErr } = await auth.supabase
    .from("integrations")
    .select("*")
    .eq("id", integId)
    .eq("tenant_id", tenantId)
    .single();

  if (fetchErr || !integration) {
    return NextResponse.json(
      { data: null, error: "Integration not found" },
      { status: 404 }
    );
  }

  if (integration.status === "inactive") {
    return NextResponse.json(
      { data: null, error: "Cannot sync an inactive integration" },
      { status: 400 }
    );
  }

  const result = await runSync(auth.supabase, integration as IntegrationRow);

  const status = result.status === "success" ? 200 : 500;
  return NextResponse.json({ data: result, error: result.error ?? null }, { status });
}
