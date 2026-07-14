import { WalletButton } from "../wallet-button";
import { MainnetStackDeployment } from "./mainnet-stack-deployment";
import "../deploy-testnet/deployment.css";

export default function DeployMainnetPage() {
  return (
    <main className="deployment-page">
      <nav className="deployment-nav">
        <a className="brand" href="/">RMT</a>
        <WalletButton target="mainnet" />
      </nav>
      <section className="deployment-hero">
        <p className="eyebrow">Operator-only V5 mainnet release</p>
        <h1>Deploy the corrected RMT V5 stack</h1>
        <p>
          This one-time console uses wallet approvals only. It never requests or stores a private key,
          and it verifies one-wallet governance, Fair Start limits, identity protection, revenue destinations,
          and every permanent binding before the site can be cut over.
        </p>
      </section>
      <MainnetStackDeployment />
    </main>
  );
}
