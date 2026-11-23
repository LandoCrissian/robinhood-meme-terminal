import { reviewLaunches } from "../lib/server/public-review";
import { headers } from "next/headers";
import { NewEngineLaunches } from "./_components/new-engine-launches";
import { FixtureLaunches } from "./_components/fixture-launches";
import { configuredCurveFixture } from "../lib/server/curve-fixture";
import { readFixtureLaunches } from "../lib/server/fixture-discovery";
import { configuredProductionDiscovery, productionDirectory, readProductionDiscovery } from "../lib/server/production-discovery";

export const dynamic = "force-dynamic";

async function NewEngineSection() {
  const requestHeaders = await headers();
  const review = await reviewLaunches();
  if (review) return <NewEngineLaunches directory={review} />;
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
    <NewEngineSection />
  </>;
}
