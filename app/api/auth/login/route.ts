import { NextResponse } from "next/server";

/**
 * Authentication is handled by the Clerk frontend SDK.
 * This endpoint is no longer used and returns 410 Gone.
 */
export async function POST() {
  return NextResponse.json(
    { data: null, error: "Authentication is handled by Clerk. Use the frontend SDK to sign in." },
    { status: 410 }
  );
}
