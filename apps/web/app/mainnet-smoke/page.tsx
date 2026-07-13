import { WalletButton } from "../wallet-button";
import { MainnetSmokeConsole } from "./mainnet-smoke-console";
import "../deploy-testnet/deployment.css";
import "./smoke.css";

export default function MainnetSmokePage() {
  return (
    <main className="deployment-shell">
      <header className="deployment-header">
        <a className="deployment-back" href="/">← RMT</a>
        <WalletButton target="mainnet" />
      </header>
      <section className="deployment-intro">
        <p className="eyebrow">PRIVATE MAINNET STAGING</p>
        <h1>Prove the launch loop before going public.</h1>
        <p>
          Operator-only disposable launch, low-value curve trade, sell, and reward claim.
          Every mainnet action requires an explicit RMTMain wallet approval.
        </p>
      </section>
      <MainnetSmokeConsole />
    </main>
  );
}
