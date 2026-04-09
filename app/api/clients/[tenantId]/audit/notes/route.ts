import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ tenantId: string }>;
}

// GET /api/clients/[tenantId]/audit/notes
// Returns all notes for the tenant as { data: Record<string, string> }
export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId } = await params;

  const { data, error } = await auth.supabase
    .from("audit_notes")
    .select("email, note")
    .eq("tenant_id", tenantId);

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 });
  }

  const noteMap: Record<string, string> = {};
  for (const row of data ?? []) {
    noteMap[row.email] = row.note;
  }

  return NextResponse.json({ data: noteMap, error: null });
}

// PUT /api/clients/[tenantId]/audit/notes
// Body: { email: string; note: string }
// Upserts a single note. Deletes the row if note is empty.
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId } = await params;

  let email: string;
  let note: string;
  try {
    const body = await req.json();
    email = body?.email?.trim();
    note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!email) {
      return NextResponse.json({ data: null, error: "email is required" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ data: null, error: "Invalid request body" }, { status: 400 });
  }

  if (!note) {
    // Delete the note if content is empty
    const { error } = await auth.supabase
      .from("audit_notes")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("email", email);

    if (error) {
      return NextResponse.json({ data: null, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ data: { email, note: "" }, error: null });
  }

  const { error } = await auth.supabase
    .from("audit_notes")
    .upsert(
      { tenant_id: tenantId, email, note, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,email" }
    );

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: { email, note }, error: null });
}
