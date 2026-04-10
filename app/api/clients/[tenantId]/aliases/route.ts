import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { z, ZodError } from "zod";

interface RouteParams {
  params: Promise<{ tenantId: string }>;
}

const createAliasSchema = z.object({
  primaryEmail: z.string().email(),
  aliasEmail: z.string().email(),
});

// GET /api/clients/[tenantId]/aliases
export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId } = await params;

  const { data, error } = await auth.supabase
    .from("user_aliases")
    .select("id, primary_email, alias_email, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data, error: null });
}

// POST /api/clients/[tenantId]/aliases
export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const { tenantId } = await params;

  try {
    const body = await req.json();
    const { primaryEmail, aliasEmail } = createAliasSchema.parse(body);

    // Sanity check: alias and primary can't be the same
    if (primaryEmail.toLowerCase() === aliasEmail.toLowerCase()) {
      return NextResponse.json(
        { data: null, error: "Alias email and primary email cannot be the same" },
        { status: 400 }
      );
    }

    const { data, error } = await auth.supabase
      .from("user_aliases")
      .insert({
        tenant_id: tenantId,
        primary_email: primaryEmail.toLowerCase().trim(),
        alias_email: aliasEmail.toLowerCase().trim(),
      })
      .select("id, primary_email, alias_email, created_at")
      .single();

    if (error) {
      // Unique constraint violation → alias already mapped
      if (error.code === "23505") {
        return NextResponse.json(
          { data: null, error: "This alias email is already mapped to a primary" },
          { status: 409 }
        );
      }
      return NextResponse.json({ data: null, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data, error: null }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { data: null, error: "Validation error", details: err.errors },
        { status: 400 }
      );
    }
    return NextResponse.json({ data: null, error: "Internal server error" }, { status: 500 });
  }
}
