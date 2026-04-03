import { NextResponse } from "next/server";

/**
 * Session sign-out is handled by the Clerk frontend SDK.
 * This endpoint is kept for backwards compatibility and returns success immediately.
 */
export async function POST() {
  return NextResponse.json({ data: { message: "Logged out" }, error: null });
}
