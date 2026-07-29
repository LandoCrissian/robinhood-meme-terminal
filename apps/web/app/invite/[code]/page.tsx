import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { normalizeReferralCode } from "../../../lib/referrals";
import { InviteAcceptance } from "./invite-acceptance";

export const metadata: Metadata = {
  title: "Your RMT invite",
  description: "Accept an invitation to Robinhood Meme Terminal and build a private cross-device trading profile.",
  robots: { index: false, follow: false }
};

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const normalized = normalizeReferralCode(code);
  if (!normalized) redirect("/");
  return <InviteAcceptance code={normalized} />;
}
