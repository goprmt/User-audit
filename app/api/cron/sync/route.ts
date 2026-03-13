import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runSync } from "@/lib/sync";
import type { IntegrationRow } from "@/types";

/**
 * Vercel Cron Job — runs on the 1st of every month.
 * Syncs all active integrations across all tenants.
 * Secured via CRON_SECRET header check.
 */
export async function GET(req: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { data: null, error: "Unauthorized" },
      { status: 401 }
    );
  }

  console.log("[CRON] Monthly sync started");

  // Fetch all active integrations (uses service role — bypasses RLS)
  const { data: integrations, error } = await supabaseAdmin
    .from("integrations")
    .select("*")
    .eq("status", "active");

  if (error) {
    console.error("[CRON] Failed to fetch integrations:", error.message);
    return NextResponse.json(
      { data: null, error: error.message },
      { status: 500 }
    );
  }

  console.log(`[CRON] Found ${integrations.length} active integrations`);

  const results: { integrationId: string; status: string; userCount: number; error?: string }[] = [];

  for (const intg of integrations) {
    console.log(`[CRON] Syncing ${intg.id} (${intg.app_name})`);
    try {
      // Use admin client for cron — no user session
      const result = await runSync(supabaseAdmin, intg as IntegrationRow);
      results.push(result);
      console.log(`[CRON] ${intg.id}: ${result.status} — ${result.userCount} users`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        integrationId: intg.id,
        status: "failed",
        userCount: 0,
        error: message,
      });
      console.error(`[CRON] ${intg.id} failed:`, message);
    }
  }

  console.log("[CRON] Monthly sync complete");

  return NextResponse.json({ data: { synced: results.length, results }, error: null });
}
