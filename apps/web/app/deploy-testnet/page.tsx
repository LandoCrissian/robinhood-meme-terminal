import Link from "next/link";
import { notFound } from "next/navigation";
import { WalletButton } from "../wallet-button";
import { TestnetStackDeployment } from "./testnet-stack-deployment";
import "./deployment.css";

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function DeployTestnetPage() {
  if (process.env.NODE_ENV === "production"
    || process.env.VERCEL === "1"
    || process.env.RMT_OPERATOR_CONSOLES_ENABLED !== "true") notFound();

  return (
    <main className="deployment-shell">
      <header className="deployment-header">
        <Link href="/" className="deployment-back">← Terminal</Link>
        <WalletButton />
      </header>
      <section className="deployment-intro">
        <span className="eyebrow">OPERATOR TOOL · ROBINHOOD TESTNET ONLY</span>
        <h1>Deploy platform infrastructure</h1>
        <p>This one-time, gas-heavy setup is for the platform operator. Token creators never deploy this stack or pay this cost.</p>
      </section>
      <TestnetStackDeployment />
    </main>
  );
}
