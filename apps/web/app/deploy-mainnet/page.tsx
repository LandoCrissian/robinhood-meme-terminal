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
        <p className="eyebrow">Operator-only mainnet release</p>
        <h1>Deploy the reviewed RMT launch stack</h1>
        <p>
          This one-time console uses wallet approvals only. It never requests or stores a private key,
          and it verifies every address and permanent binding before publishing the release.
        </p>
      </section>
      <MainnetStackDeployment />
    </main>
  );
}
