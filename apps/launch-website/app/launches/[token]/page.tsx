import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { isLaunchAddress } from "../../../lib/launch-data";
import { FixtureLaunchDetails, FixtureTransactionRecovery } from "../../_components/fixture-launches";
import { configuredCurveFixture } from "../../../lib/server/curve-fixture";
import { readFixtureLaunches } from "../../../lib/server/fixture-discovery";

export const dynamic = "force-dynamic";

export default async function LaunchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isLaunchAddress(token)) notFound();
  const address = token.toLowerCase();
  const fixture = configuredCurveFixture(await headers());
  if (!fixture) notFound();
  const directory = await readFixtureLaunches(fixture, address);
  if (directory.status === "ready" && directory.launches[0]) return <FixtureLaunchDetails launch={directory.launches[0]} fixture={fixture} />;
  return <>
    <Link className="lpBack" href="/" prefetch={false}>← Launches</Link>
    <header className="lpPageHeading"><div><h1>{directory.status === "unavailable" ? "New-engine evidence unavailable" : "Test token not registered"}</h1><p>Anvil 31337 · Synthetic test only</p></div></header>
    <p className="lpNotice" role="status"><code className="lpAddress">{address}</code> {directory.status === "unavailable" ? "cannot be verified at this checkpoint." : "has no registration at the verified checkpoint."}</p>
    <FixtureTransactionRecovery token={address} fixture={fixture} />
  </>;
}
