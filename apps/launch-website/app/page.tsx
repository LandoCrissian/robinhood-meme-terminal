import Link from "next/link";
import { headers } from "next/headers";
import { NewEngineLaunches } from "./_components/new-engine-launches";
import { FixtureLaunches } from "./_components/fixture-launches";
import { configuredCurveFixture } from "../lib/server/curve-fixture";
import { readFixtureLaunches } from "../lib/server/fixture-discovery";
import { configuredProductionDiscovery, productionDirectory, readProductionDiscovery } from "../lib/server/production-discovery";
import { HistoricalArchive } from "./_components/historical-archive";

export const dynamic = "force-dynamic";

async function NewEngineSection() {
  const requestHeaders = await headers();
  const fixture = configuredCurveFixture(requestHeaders);
  if (fixture) return <FixtureLaunches directory={await readFixtureLaunches(fixture)} />;
  if (!configuredProductionDiscovery(requestHeaders)) return <NewEngineLaunches directory={{ status: "prelaunch" }} />;
  const data = await readProductionDiscovery();
  return <>
    {data.status !== "unavailable" && <p className="lpNotice">{data.status === "stale" ? "Stale creation records" : "Observed creation records"} · checkpoint {data.checkpoint.blockNumber} · {data.checkpoint.timestamp}. Current curve activity and Ethereum L1 finality are unverified.</p>}
    <NewEngineLaunches directory={productionDirectory(data)} />
  </>;
}

export default async function Home() {
  const fixture = configuredCurveFixture(await headers());
  return <>
    <div className="lpOverview"><header className="lpOverviewCopy"><span className="lpEyebrow">RMT Launch · Robinhood Chain</span>
      <h1>Launches</h1><p>Discover new projects and follow their path from bonding curve to locked Uniswap v4 liquidity.</p>
      <div className="lpDraftActions"><Link className="lpButton" href="/create-token" prefetch={false}>Create token</Link><Link className="lpButton lpSecondary" href="/wallet" prefetch={false}>Your wallet & profile</Link></div>
      <p className="lpInlineNotice" style={{ marginTop: 16 }}>{fixture ? "Isolated Anvil test environment · synthetic transactions only." : "Read-only preview · Token creation, trading and fee claims are disabled."}</p>
    </header><ol className="lpLaunchSteps" aria-label="Launch lifecycle"><li><span>01 / CREATE</span><strong>One billion tokens</strong><p>Fixed supply. Review your metadata and creator treasury.</p></li><li><span>02 / CURVE</span><strong>Transparent reserves</strong><p>60% curve allocation with disclosed trading fees.</p></li><li><span>03 / GRADUATE</span><strong>Funded v4 liquidity</strong><p>40% reserved for the original locked position.</p></li><li><span>04 / FOLLOW</span><strong>Verifiable activity</strong><p>Canonical receipts and evidence before status claims.</p></li></ol></div>
    <div className="lpSectionHeading"><div><h2>New-engine launches</h2><p>Confirmed new-factory registrations, separate from historical tokens.</p></div><span className="lpPill">Robinhood Chain 4663</span></div>
    <NewEngineSection />
    <HistoricalArchive />
  </>;
}
