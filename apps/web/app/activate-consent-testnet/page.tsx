import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { WalletButton } from "../wallet-button";
import { ConsentTestnetActivation } from "./consent-testnet-activation";
import "../deploy-testnet/deployment.css";

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function isLoopbackHost(host: string | null) {
  const value = host?.trim().toLowerCase() ?? "";
  return value === "localhost"
    || value.startsWith("localhost:")
    || value === "127.0.0.1"
    || value.startsWith("127.0.0.1:")
    || value === "[::1]"
    || value.startsWith("[::1]:");
}

export default async function ActivateConsentTestnetPage() {
  if (
    process.env.NODE_ENV === "production"
    || process.env.VERCEL === "1"
    || process.env.RMT_OPERATOR_CONSOLES_ENABLED !== "true"
    || process.env.RMT_CONSENT_TESTNET_ACTIVATION_ENABLED !== "true"
  ) notFound();
  if (!isLoopbackHost((await headers()).get("host"))) notFound();

  return (
    <main className="deployment-shell activation-shell">
      <header className="deployment-header">
        <Link href="/rescue" className="deployment-back">← Migration lab</Link>
        <WalletButton target="testnet" showFunding={false} />
      </header>
      <section className="deployment-intro">
        <span className="eyebrow">LOCAL OPERATOR TOOL · ROBINHOOD TESTNET 46630</span>
        <h1>Activate the consent rehearsal</h1>
        <p>
          This loopback-only console can propose one exact zero-value call: unpause the reviewed testnet migrator.
          It cannot move tokens, configure a different target, or expose a public migration interface.
        </p>
      </section>
      <ConsentTestnetActivation />
    </main>
  );
}
