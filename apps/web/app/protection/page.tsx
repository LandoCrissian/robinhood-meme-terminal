import type { Metadata } from "next";
import { ProtectionCenterBoundary } from "./protection-center-boundary";
import { RMT_SITE_NAME } from "../../lib/site-identity";

export const metadata: Metadata = {
  title: `Protection Center | ${RMT_SITE_NAME}`,
  description: "Review active, completed, interrupted, and revocation-pending automatic Position Guard orders for your RMT wallets.",
  alternates: { canonical: "/protection" },
  robots: { index: false, follow: false }
};

export default function ProtectionPage() {
  return <ProtectionCenterBoundary />;
}
