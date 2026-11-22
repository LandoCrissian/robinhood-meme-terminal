import { headers } from "next/headers";
import Link from "next/link";
import { NewEngineLaunches } from "./_components/new-engine-launches";
import { FixtureLaunches } from "./_components/fixture-launches";
import { configuredCurveFixture } from "../lib/server/curve-fixture";
import { readFixtureLaunches } from "../lib/server/fixture-discovery";
import { configuredProductionDiscovery, productionDirectory, readProductionDiscovery } from "../lib/server/production-discovery";

export const dynamic = "force-dynamic";

async function NewEngineSection() {
  const requestHeaders = await headers();
  const fixture = configuredCurveFixture(requestHeaders);
  if (fixture) return <FixtureLaunches directory={await readFixtureLaunches(fixture)} />;
  if (!configuredProductionDiscovery(requestHeaders)) return <NewEngineLaunches directory={{ status: "prelaunch" }} />;
  const data = await readProductionDiscovery();
  return <>
    <NewEngineLaunches directory={productionDirectory(data)} />
    {data.status !== "unavailable" && <details className="lpFeedStatus"><summary>Data status</summary>
      <p>Checkpoint {data.checkpoint.blockNumber} · {data.checkpoint.timestamp}. Current curve activity and Ethereum L1 finality are unverified.</p></details>}
  </>;
}

export default async function Home() {
  const fixture = configuredCurveFixture(await headers());
  return <>
    <header className="lpDiscoveryHeading"><h1>Launches</h1><span className="lpDiscoveryChain">{fixture ? "Anvil 31337 · synthetic test only" : "Robinhood Chain"}</span></header>
    <div className="lpHomeIntro"><p>Explore tokens created on Robinhood Chain.</p><div className="lpActions">
      <Link className="lpUtility" href="/people" prefetch={false}>Browse people →</Link>
      <Link className="lpButton lpSecondary" href="/create-token" prefetch={false}>Prepare a token draft</Link>
    </div></div>
    <NewEngineSection />
  </>;
}
