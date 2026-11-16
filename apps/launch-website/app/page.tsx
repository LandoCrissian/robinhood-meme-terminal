import Link from "next/link";
import { headers } from "next/headers";
import { NewEngineLaunches } from "./_components/new-engine-launches";
import { FixtureLaunches } from "./_components/fixture-launches";
import { configuredCurveFixture } from "../lib/server/curve-fixture";
import { readFixtureLaunches } from "../lib/server/fixture-discovery";

export const dynamic = "force-dynamic";

async function NewEngineSection() {
  const fixture = configuredCurveFixture(await headers());
  return fixture ? <FixtureLaunches directory={await readFixtureLaunches(fixture)} />
    : <NewEngineLaunches directory={{ status: "prelaunch" }} />;
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
