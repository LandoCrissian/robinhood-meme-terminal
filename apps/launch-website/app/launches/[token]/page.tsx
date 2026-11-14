import { notFound } from "next/navigation";
import Link from "next/link";
import { isLaunchAddress } from "../../../lib/launch-data";
import { readLaunchDirectory } from "../../../lib/server/launch-data";
import { HistoricalLaunchDetails } from "../../_components/historical-launch";
import { LaunchFreshness } from "../../_components/launch-freshness";

export const dynamic = "force-dynamic";

export default async function LaunchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isLaunchAddress(token)) notFound();
  const address = token.toLowerCase();
  const data = await readLaunchDirectory(address);
  const launch = data.launches.find((entry) => entry.token.toLowerCase() === address);
  if (launch) return <HistoricalLaunchDetails launch={launch} data={data} />;
  if (data.status !== "unavailable") notFound();
  return <>
    <Link className="lpBack" href="/" prefetch={false}>← Launches</Link>
    <header className="lpPageHeading"><div><h1>Launch data unavailable</h1><p>Robinhood Chain 4663</p></div></header>
    <LaunchFreshness data={data} />
    <p className="lpNotice">Registration could not be verified for <code className="lpAddress">{address}</code>. Try again when the directory is available.</p>
  </>;
}
