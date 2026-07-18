import Link from "next/link";
import { notFound } from "next/navigation";
import { WalletButton } from "../wallet-button";
import { ConsentTestnetDeployment } from "./consent-testnet-deployment";
import "../deploy-testnet/deployment.css";

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function DeployConsentTestnetPage() {
  if (process.env.NODE_ENV === "production"
    || process.env.VERCEL === "1"
    || process.env.RMT_CONSENT_TESTNET_DEPLOYMENT_ENABLED !== "true") notFound();

  return (
    <main className="deployment-shell">
      <header className="deployment-header">
        <Link href="/rescue" className="deployment-back">← Migration lab</Link>
        <WalletButton target="testnet" showFunding={false} />
      </header>
      <section className="deployment-intro">
        <span className="eyebrow">OPERATOR TOOL · ROBINHOOD TESTNET ONLY</span>
        <h1>Deploy the paused consent rehearsal</h1>
        <p>Two deterministic wallet approvals create a valueless venue and the code-bound consent router. Nothing here enables a public migration interface or accepts real funds.</p>
      </section>
      <ConsentTestnetDeployment />
    </main>
  );
}
