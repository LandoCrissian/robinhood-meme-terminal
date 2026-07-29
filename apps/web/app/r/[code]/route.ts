import { NextRequest, NextResponse } from "next/server";
import { normalizeReferralCode } from "../../../lib/referrals";

export async function GET(request: NextRequest, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const normalized = normalizeReferralCode(code);
  const destination = new URL("/", request.nextUrl.origin);
  if (normalized) destination.searchParams.set("ref", normalized);
  return NextResponse.redirect(destination, 307);
}
