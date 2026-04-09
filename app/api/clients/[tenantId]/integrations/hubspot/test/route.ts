import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ tenantId: string }>;
}

// POST /api/clients/[tenantId]/integrations/hubspot/test
// Body: { accessToken: string }
// Makes a lightweight call to HubSpot to validate the token.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  // params is used for future tenant-scoped logging; destructure to avoid lint warning
  await params;

  let accessToken: string;
  try {
    const body = await req.json();
    accessToken = body?.accessToken;
    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json(
        { data: null, error: "accessToken is required" },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json({ data: null, error: "Invalid request body" }, { status: 400 });
  }

  try {
    const res = await fetch("https://api.hubapi.com/settings/v3/users?limit=1", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        { data: null, error: `HubSpot rejected the token (${res.status}): ${body.slice(0, 200)}` },
        { status: 400 }
      );
    }

    const data = await res.json();
    const userCount: number = data?.results?.length ?? 0;

    return NextResponse.json({ data: { valid: true, userCount }, error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }
}
