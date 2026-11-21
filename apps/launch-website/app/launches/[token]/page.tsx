import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { isLaunchAddress } from "../../../lib/launch-data";
import { FixtureLaunchDetails, FixtureTransactionRecovery } from "../../_components/fixture-launches";
import { configuredCurveFixture } from "../../../lib/server/curve-fixture";
import { readFixtureLaunches } from "../../../lib/server/fixture-discovery";
import { configuredProductionDiscovery, productionDirectory } from "../../../lib/server/production-discovery";
import { launchMetadata, tokenDiscovery } from "../../../lib/server/social-pages";
import { LaunchProvenance } from "../../_components/launch-provenance";
import { TokenArtwork } from "../../_components/token-artwork";
import { CreatorLink } from "../../_components/creator-link";
import { availableProductionFinancial } from "../../../lib/server/production-financial";
import { ProductionLifecycleWallet } from "../../_components/production-lifecycle-wallet";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isLaunchAddress(token)) notFound();
  return launchMetadata(token.toLowerCase());
}

export default async function LaunchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isLaunchAddress(token)) notFound();
  const address = token.toLowerCase();
  const requestHeaders = await headers();
  const fixture = configuredCurveFixture(requestHeaders);
  if (!fixture) {
    if (!configuredProductionDiscovery(requestHeaders)) notFound();
    const data = await tokenDiscovery(address);
    const directory = productionDirectory(data);
    const trading = data.status === "ready" && data.launches[0] && await availableProductionFinancial(requestHeaders, "trading");
    return <>
      <Link className="lpBack" href="/" prefetch={false}>← Launches</Link>
      <header className="lpPageHeading"><div><h1>{data.status === "unavailable" ? "New-engine evidence unavailable" : data.launches[0]?.name ?? "Indexing pending"}</h1><p>Robinhood Chain 4663 · verified creation evidence</p></div></header>
      <p className="lpNotice" role="status">{data.status === "unavailable" ? "Registration cannot be verified right now. An unavailable read does not mean the token was never registered."
        : data.status === "stale" ? "Stale registration checkpoint. Current lifecycle and trading are unverified."
        : data.launches.length ? "Creation confirmed at the indexed checkpoint. Trading and claims remain separately gated." : "No registration at this verified checkpoint. A newly confirmed transaction may still be indexing."}</p>
      {data.status === "ready" && data.launches[0] && <TokenArtwork symbol={data.launches[0].symbol} projectURI={data.launches[0].projectURI} />}
      <code className="lpAddress">{address}</code>
      {directory.status === "ready" && directory.launches[0] && <LaunchProvenance launch={directory.launches[0]} />}
      {directory.status === "stale" && directory.history[0] && <details className="lpFeedStatus">
        <summary>Last-known creation history (stale)</summary><LaunchProvenance launch={directory.history[0]} />
      </details>}
      {data.status !== "unavailable" && data.launches[0] && <dl className="lpFacts">
        <dt>Creator</dt><dd className="lpAddress"><CreatorLink wallet={data.launches[0].creator} label={data.launches[0].creator} /></dd>
        <dt>Project treasury</dt><dd className="lpAddress">{data.launches[0].treasury ?? "None"}</dd>
        <dt>Treasury allocation</dt><dd>{data.launches[0].treasuryShareBps / 100}% of total collected fees</dd>
        <dt>Submitted project URI</dt><dd>{data.launches[0].projectURI || "None"}</dd>
        <dt>Checkpoint</dt><dd>{data.checkpoint.blockNumber} · {data.checkpoint.timestamp}</dd>
      </dl>}
      {trading && data.status === "ready" && data.launches[0] && <ProductionLifecycleWallet token={data.launches[0].token}
        curve={data.launches[0].initialCurve} symbol={data.launches[0].symbol} />}
    </>;
  }
  const directory = await readFixtureLaunches(fixture, address);
  if (directory.status === "ready" && directory.launches[0]) return <FixtureLaunchDetails launch={directory.launches[0]} fixture={fixture} />;
  return <>
    <Link className="lpBack" href="/" prefetch={false}>← Launches</Link>
    <header className="lpPageHeading"><div><h1>{directory.status === "unavailable" ? "New-engine evidence unavailable" : "Test token not registered"}</h1><p>Anvil 31337 · Synthetic test only</p></div></header>
    <p className="lpNotice" role="status"><code className="lpAddress">{address}</code> {directory.status === "unavailable" ? "cannot be verified at this checkpoint." : "has no registration at the verified checkpoint."}</p>
    <FixtureTransactionRecovery token={address} fixture={fixture} />
  </>;
}
