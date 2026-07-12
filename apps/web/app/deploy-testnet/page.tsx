import Link from "next/link";
import { WalletButton } from "../wallet-button";
import { TestnetStackDeployment } from "./testnet-stack-deployment";
import "./deployment.css";

export default function DeployTestnetPage() {
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
