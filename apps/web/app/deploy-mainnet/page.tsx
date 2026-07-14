import { WalletButton } from "../wallet-button";
import { OfficialRmtMigration } from "./official-rmt-migration";
import "../deploy-testnet/deployment.css";

export default function DeployMainnetPage() {
  return (
    <main className="deployment-page">
      <nav className="deployment-nav">
        <a className="brand" href="/">RMT</a>
        <WalletButton target="mainnet" />
      </nav>
      <section className="deployment-hero">
        <p className="eyebrow">Operator-only V6 mainnet migration</p>
        <h1>Prepare the official RMT relaunch</h1>
        <p>
          V5 is live and remains active while this console prepares the reviewed V6 identity migration.
          It uses wallet approvals only, preserves the corrected economics, and verifies every permanent
          binding before the delayed factory upgrade can be activated.
        </p>
      </section>
      <OfficialRmtMigration />
    </main>
  );
}
