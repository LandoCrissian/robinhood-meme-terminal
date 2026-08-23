import { notFound } from "next/navigation";
import { WalletButton } from "../wallet-button";
import { V6ReleaseConsole } from "./v6-release-console";
import "../deploy-testnet/deployment.css";

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function DeployMainnetPage() {
  if (process.env.NODE_ENV === "production"
    || process.env.VERCEL === "1"
    || process.env.RMT_OPERATOR_CONSOLES_ENABLED !== "true") notFound();

  return (
    <main className="deployment-shell">
      <nav className="deployment-header">
        <a className="deployment-back" href="/">← Terminal</a>
        <WalletButton target="mainnet" />
      </nav>
      <section className="deployment-intro">
        <p className="eyebrow">Archived operator-only V6 launchpad workflow</p>
        <h1>Historical V6 release evidence</h1>
        <p>
          This disabled production route preserves the former V6 operator workflow as historical engineering evidence. Launch 0 is
          dead and is not the current RMT token, an active product market, or a release requirement. The legacy V5 factory was the identity anchor while this console deployed an independent V6
          governance-and-treasury contract plus a fresh registry initialized to V5. A narrow 12-hour,
          one-use controller can activate only this exact verified foundation and can open it only after the
          official RMT launch produces a real settled fee. The launch gate stays paused until that final step;
          the 12 hours are a completion deadline, not a waiting period, so deployment, RMT, the smoke buy,
          and public opening can finish in one session. Afterward every upgrade and later reopening uses the
          permanent delays. None of those historical steps authorizes a current launch.
        </p>
      </section>
      <V6ReleaseConsole />
    </main>
  );
}
