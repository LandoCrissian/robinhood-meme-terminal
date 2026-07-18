import { notFound } from "next/navigation";
import { WalletButton } from "../wallet-button";
import { MainnetSmokeConsole } from "./mainnet-smoke-console";
import "../deploy-testnet/deployment.css";
import "./smoke.css";

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function MainnetSmokePage() {
  if (process.env.NODE_ENV === "production"
    || process.env.VERCEL === "1"
    || process.env.RMT_OPERATOR_CONSOLES_ENABLED !== "true") notFound();

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
