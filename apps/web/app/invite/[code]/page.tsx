import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "RMT invites are paused",
  description: "RMT referral and profile onboarding are paused during terminal completion.",
  robots: { index: false, follow: false }
};

export default function InvitePage() {
  redirect("/");
}
