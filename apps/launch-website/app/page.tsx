import Link from "next/link";
import { headers } from "next/headers";
import { Suspense } from "react";
import { readLaunchDirectory } from "../lib/server/launch-data";
import { LaunchDirectory } from "./_components/launch-directory";
import { LaunchFreshness } from "./_components/launch-freshness";
import { NewEngineLaunches } from "./_components/new-engine-launches";
import { FixtureLaunches } from "./_components/fixture-launches";
import { configuredCurveFixture } from "../lib/server/curve-fixture";
import { readFixtureLaunches } from "../lib/server/fixture-discovery";

export const dynamic = "force-dynamic";

async function VerifiedDirectory() {
  const data = await readLaunchDirectory();
  return <section aria-label="Historical V4/V6 registrations">
    <LaunchFreshness data={data} />
    {data.truncated && <p className="lpNotice">This view shows the most recent indexed records. Enter a full token address to look up other records.</p>}
    <LaunchDirectory launches={data.launches.map(({ name, symbol, token, version, lifecycle, classification, receipt }) =>
      ({ name, symbol, token, version, lifecycle, classification, registrationBlock: receipt.blockNumber }))} />
  </section>;
}

async function NewEngineSection() {
  const fixture = configuredCurveFixture(await headers());
  return fixture ? <FixtureLaunches directory={await readFixtureLaunches(fixture)} />
    : <NewEngineLaunches directory={{ status: "prelaunch" }} />;
}

export default function Home() {
  return <>
    <header className="lpPageHeading">
      <div><h1>Launches</h1><p>Verified RMT factory registrations on Robinhood Chain.</p></div>
      <Link className="lpButton" href="/create-token" prefetch={false}>Create token</Link>
    </header>
    <NewEngineSection />
    <Suspense fallback={<p className="lpNotice" role="status">Loading verified launch records…</p>}>
      <VerifiedDirectory />
    </Suspense>
  </>;
}
