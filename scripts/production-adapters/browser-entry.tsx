import { createRoot } from "react-dom/client";
import { ProductionLifecycleWallet } from "../../apps/launch-website/app/_components/production-lifecycle-wallet";
import { EarningsProfileWallet } from "../../apps/launch-website/app/_components/earnings-profile-wallet";
import type { EarningsContractSnapshot } from "../../apps/launch-website/lib/server/earnings-contracts";
import { productionAccountLock } from "../../apps/launch-website/lib/production-wallet";
import { recordProductionConsumedNonce, productionNonceFloorKey } from "../../apps/launch-website/lib/production-nonce";

declare global { interface Window { __task092: { mode: "claims" | "trading" | "disabled"; token: string; curve: string; factory: string;
  beneficiary: string; snapshot: EarningsContractSnapshot }; } }
const fixture = window.__task092;
// Harness-only bridge to the actual pure storage/lock helpers. This script is
// never part of an application route or production deployment.
import { withProductionNonceStore } from "../../apps/launch-website/lib/production-nonce-store";
(window as any).__task092Nonce = { lockKey: productionAccountLock, key: productionNonceFloorKey,
  record: (store: Storage, account: string, nonce: string, hash: string) =>
    withProductionNonceStore(store, view => recordProductionConsumedNonce(view, account, nonce, hash)) };
createRoot(document.getElementById("root")!).render(<div className="rmtVnext rmtTerminal launchpad" data-theme="dark"><main className="lpContent task092Harness">
  <h1>Task092 adapter rehearsal</h1><p>Isolated synthetic state and wallet. No production network, signature or broadcast.</p>
  {fixture.mode !== "claims" && <ProductionLifecycleWallet token={fixture.token} curve={fixture.curve} symbol="EVID" />}
  {fixture.mode !== "trading" && <EarningsProfileWallet token={fixture.token} factory={fixture.factory} beneficiary={fixture.beneficiary}
    snapshot={fixture.snapshot} production onSettled={() => {}} />}
</main></div>);
