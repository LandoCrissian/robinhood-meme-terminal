"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { speedWalletEnabled } from "../../lib/privy-config";

const ConfiguredProtectionCenter = dynamic(
  () => import("./protection-center").then((module) => module.ProtectionCenter),
  {
    ssr: false,
    loading: () => (
      <main className="protectionCenterPage">
        <section className="protectionCenterState"><span className="protectionSpinner" /><strong>Opening protection inventory…</strong></section>
      </main>
    )
  }
);

export function ProtectionCenterBoundary() {
  if (!speedWalletEnabled) {
    return (
      <main className="protectionCenterPage">
        <section className="protectionCenterIntro compact">
          <p className="eyebrow">RMT · CONTINUING WALLET AUTHORITY</p>
          <h1>Protection Center</h1>
          <p>Automatic Position Guard recovery requires the RMT embedded-wallet configuration. No automatic authority can be created from this release environment.</p>
          <div className="protectionCenterIntroActions">
            <Link href="/">Return to terminal</Link>
            <Link href="/support">Open support</Link>
          </div>
        </section>
      </main>
    );
  }
  return <ConfiguredProtectionCenter />;
}
