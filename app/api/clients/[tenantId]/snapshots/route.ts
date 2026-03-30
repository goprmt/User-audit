import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ tenantId: string }>;
}

/**
 * GET  /api/clients/:tenantId/snapshots — list audit snapshots (most recent first)
 * POST /api/clients/:tenantId/snapshots — create a new audit snapshot from the current data
 */

export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId } = await params;

  const { data, error } = await auth.supabase
    .from("audit_snapshots")
    .select("id, tenant_id, label, total_findings, not_in_jumpcloud, offboarded_still_licensed, licenses_to_reclaim, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json(
      { data: null, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ data, error: null });
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId } = await params;

  // Parse optional label from body
  let label: string | null = null;
  try {
    const body = await req.json();
    if (body.label && typeof body.label === "string") {
      label = body.label.slice(0, 200);
    }
  } catch {
    // No body or invalid JSON — that's fine, label stays null
  }

  // Build audit findings (same logic as the frontend getAuditFindings)
  const { data: integrations } = await auth.supabase
    .from("integrations")
    .select("id, app_name")
    .eq("tenant_id", tenantId);

  const allIntegrations = integrations ?? [];
  const jumpcloudIds = new Set(
    allIntegrations
      .filter((i) => i.app_name?.toLowerCase() === "jumpcloud")
      .map((i) => i.id)
  );

  const appNameById: Record<string, string> = {};
  for (const i of allIntegrations) {
    appNameById[i.id] = i.app_name ?? "";
  }

  // Fetch all users for this tenant
  const { data: rawUsers } = await auth.supabase
    .from("users")
    .select("id, email, display_name, license_type, is_active, last_seen_at, external_created_at, integration_id")
    .eq("tenant_id", tenantId)
    .limit(5000);

  const users = rawUsers ?? [];

  // Group by email
  const byEmail = new Map<string, typeof users>();
  for (const u of users) {
    const key = (u.email ?? "").toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key)!.push(u);
  }

  interface Finding {
    email: string;
    displayName: string;
    findingType: string;
    affectedApps: { appName: string; licenseType: string; lastSeen: string }[];
    lastActive: string;
  }

  const findings: Finding[] = [];

  for (const [email, entries] of byEmail) {
    const jcEntry = entries.find((e) => jumpcloudIds.has(e.integration_id));
    const nonJcEntries = entries.filter((e) => !jumpcloudIds.has(e.integration_id));

    if (nonJcEntries.length === 0) continue;

    const affectedApps = nonJcEntries.map((e) => ({
      appName: appNameById[e.integration_id] ?? "",
      licenseType: e.license_type ?? "",
      lastSeen: e.last_seen_at ?? "",
    }));

    const allLastSeen = entries
      .map((e) => e.last_seen_at)
      .filter(Boolean)
      .sort()
      .reverse();

    if (!jcEntry) {
      findings.push({
        email,
        displayName: entries.find((e) => e.display_name)?.display_name ?? "",
        findingType: "not_in_jumpcloud",
        affectedApps,
        lastActive: allLastSeen[0] ?? "",
      });
    } else if (!jcEntry.is_active) {
      findings.push({
        email,
        displayName: entries.find((e) => e.display_name)?.display_name ?? "",
        findingType: "offboarded_still_licensed",
        affectedApps,
        lastActive: allLastSeen[0] ?? "",
      });
    }
  }

  const notInJc = findings.filter((f) => f.findingType === "not_in_jumpcloud").length;
  const offboardedLicensed = findings.filter((f) => f.findingType === "offboarded_still_licensed").length;
  const licensesToReclaim = findings.reduce((sum, f) => sum + f.affectedApps.length, 0);

  // Insert snapshot
  const { data: snapshot, error } = await auth.supabase
    .from("audit_snapshots")
    .insert({
      tenant_id: tenantId,
      label,
      total_findings: findings.length,
      not_in_jumpcloud: notInJc,
      offboarded_still_licensed: offboardedLicensed,
      licenses_to_reclaim: licensesToReclaim,
      snapshot_data: findings,
    })
    .select("id, tenant_id, label, total_findings, not_in_jumpcloud, offboarded_still_licensed, licenses_to_reclaim, created_at")
    .single();

  if (error) {
    return NextResponse.json(
      { data: null, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: snapshot, error: null }, { status: 201 });
}
