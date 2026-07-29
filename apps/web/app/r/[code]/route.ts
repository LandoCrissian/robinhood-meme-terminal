import { NextRequest, NextResponse } from "next/server";
import { normalizeReferralCode } from "../../../lib/referrals";

export async function GET(request: NextRequest, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const normalized = normalizeReferralCode(code);
  const destination = new URL(normalized ? `/invite/${normalized}` : "/", request.nextUrl.origin);
  return NextResponse.redirect(destination, 307);
}
