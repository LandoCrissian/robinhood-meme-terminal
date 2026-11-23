import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { CreatorDraft } from "../_components/creator-draft";
import { configuredCurveFixture } from "../../lib/server/curve-fixture";
import { configuredCurveProductionRelease, curveProductionDeployment, curveProductionPins } from "../../lib/server/curve-production";
import { productionCreationEnabled } from "../../lib/server/production-creation";
import { configuredProductionDiscovery } from "../../lib/server/production-discovery";
import { configuredProjectTreasuryFixture } from "../../lib/server/project-treasury-fixture";

export const metadata: Metadata = { title: "Create Token | RMT Launch" };

export default async function CreateTokenPage() {
  const requestHeaders = await headers();
  const fixture = configuredCurveFixture(requestHeaders);
  const release = !fixture && productionCreationEnabled() ? configuredCurveProductionRelease(requestHeaders, process.env, false) : null;
  // Live evidence belongs to the authenticated preparation request. An RPC outage
  // must not change which controls the configured release renders.
  const ownerCreationConfigured = Boolean(release && configuredProductionDiscovery(requestHeaders));
  return <>
    <header className="lpPageHeading lpCreatorPageHeading">
      <div><h1>Create Token</h1><p>Choose your artwork and token details, then review the fees and recipients.</p></div>
      <Link className="lpButton lpSecondary" href="/" prefetch={false}>Browse launches</Link>
    </header>
    <p className="lpNotice lpCreatorMode">{ownerCreationConfigured ? "Owner creation acceptance · Robinhood Chain 4663 · real ETH. Each transaction requires your explicit wallet confirmation."
      : fixture ? "Isolated test mode · Anvil 31337 · synthetic funds only."
      : "Draft only. You can save and review your token here. On-chain creation is disabled."}</p>
    <CreatorDraft executionTest={fixture ? { factory: fixture.factory, projectTreasury: !!configuredProjectTreasuryFixture(requestHeaders) } : undefined}
      productionCreation={ownerCreationConfigured ? { factory: curveProductionPins.factory[0], operating: curveProductionDeployment.operating,
        reserve: curveProductionDeployment.reserve } : undefined} />
  </>;
}
