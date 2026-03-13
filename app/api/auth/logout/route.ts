import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  await auth.supabase.auth.signOut();

  return NextResponse.json({ data: { message: "Logged out" }, error: null });
}
