import Link from "next/link";
import { headers } from "next/headers";
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
    {data.status !== "unavailable" && <p className="lpNotice">{data.status === "stale" ? "Stale creation records" : "Observed creation records"} · checkpoint {data.checkpoint.blockNumber} · {data.checkpoint.timestamp}. Current curve activity and Ethereum L1 finality are unverified.</p>}
    <NewEngineLaunches directory={productionDirectory(data)} />
  </>;
}

export default function Home() {
  return <>
    <header className="lpPageHeading">
      <div><h1>Launches</h1><p>Verified launches on Robinhood Chain.</p></div>
      <Link className="lpButton" href="/create-token" prefetch={false}>Create token</Link>
    </header>
    <NewEngineSection />
  </>;
}
