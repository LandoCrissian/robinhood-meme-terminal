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
        <span className="eyebrow">ROBINHOOD TESTNET ONLY</span>
        <h1>Deploy the test launch stack</h1>
        <p>Connect your wallet and approve the guided transactions. No private key or recovery phrase is ever requested.</p>
      </section>
      <TestnetStackDeployment />
    </main>
  );
}
