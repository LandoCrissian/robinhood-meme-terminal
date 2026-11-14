import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { isLaunchAddress } from "../../../lib/launch-data";
import { readLaunchDirectory } from "../../../lib/server/launch-data";
import { HistoricalLaunchDetails } from "../../_components/historical-launch";
import { LaunchFreshness } from "../../_components/launch-freshness";
import { FixtureLaunchDetails, FixtureTransactionRecovery } from "../../_components/fixture-launches";
import { configuredCurveFixture } from "../../../lib/server/curve-fixture";
import { readFixtureLaunches } from "../../../lib/server/fixture-discovery";

export const dynamic = "force-dynamic";

export default async function LaunchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isLaunchAddress(token)) notFound();
  const address = token.toLowerCase();
  const data = await readLaunchDirectory(address);
  const launch = data.launches.find((entry) => entry.token.toLowerCase() === address);
  if (launch) return <HistoricalLaunchDetails launch={launch} data={data} />;
  const fixture = configuredCurveFixture(await headers());
  if (fixture) {
    const directory = await readFixtureLaunches(fixture, address);
    if (directory.status === "ready" && directory.launches[0]) return <FixtureLaunchDetails launch={directory.launches[0]} fixture={fixture} />;
    return <>
      <Link className="lpBack" href="/" prefetch={false}>← Launches</Link>
      <header className="lpPageHeading"><div><h1>{directory.status === "unavailable" ? "New-engine evidence unavailable" : "Test token not registered"}</h1><p>Anvil 31337 · Synthetic test only</p></div></header>
      <p className="lpNotice" role="status"><code className="lpAddress">{address}</code> {directory.status === "unavailable" ? "cannot be verified at this checkpoint." : "has no registration at the verified checkpoint."}</p>
      <FixtureTransactionRecovery token={address} fixture={fixture} />
    </>;
  }
  if (data.status !== "unavailable") notFound();
  return <>
    <Link className="lpBack" href="/" prefetch={false}>← Launches</Link>
    <header className="lpPageHeading"><div><h1>Launch data unavailable</h1><p>Robinhood Chain 4663</p></div></header>
    <LaunchFreshness data={data} />
    <p className="lpNotice">Registration could not be verified for <code className="lpAddress">{address}</code>. Try again when the directory is available.</p>
  </>;
}
