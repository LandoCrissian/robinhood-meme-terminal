import { WalletButton } from "../wallet-button";
import { V6ReleaseConsole } from "./v6-release-console";
import "../deploy-testnet/deployment.css";

export default function DeployMainnetPage() {
  return (
    <main className="deployment-page">
      <nav className="deployment-nav">
        <a className="brand" href="/">RMT</a>
        <WalletButton target="mainnet" />
      </nav>
      <section className="deployment-hero">
        <p className="eyebrow">Operator-only V6 mainnet release</p>
        <h1>Deploy V6 without opening it early</h1>
        <p>
          V5 remains active while this console deploys and verifies the policy-driven V6 foundation.
          Policies, activation, and reopening each follow their onchain delays. The new launch gate stays
          paused until the final, separate reopening step.
        </p>
      </section>
      <V6ReleaseConsole />
    </main>
  );
}
