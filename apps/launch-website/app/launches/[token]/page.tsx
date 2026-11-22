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
import { readMarketResponse } from "../../../lib/server/market-response";
import { TokenMarket } from "../../_components/token-market";

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
    if (data.status === "ready" && data.launches.length === 0) {
      const response = await readMarketResponse(address, 60, null);
      if (response.status === 404) {
        const { checkpoint } = await response.json();
        const height = BigInt(checkpoint.blockNumber), registeredThrough = BigInt(data.checkpoint.blockNumber);
        if (height > registeredThrough || (height === registeredThrough && checkpoint.blockHash === data.checkpoint.blockHash)) notFound();
      }
    }
    const directory = productionDirectory(data);
    const trading = data.status === "ready" && data.launches[0] && await availableProductionFinancial(requestHeaders, "trading");
    return <>
      <Link className="lpBack" href="/" prefetch={false}>← Launches</Link>
      <header className="lpPageHeading"><div><h1>{data.status === "unavailable" ? "New-engine evidence unavailable" : data.launches[0]?.name ?? "Indexing pending"}</h1><p>Robinhood Chain 4663 · verified creation evidence</p></div></header>
      <p className="lpNotice" role="status">{data.status === "unavailable" ? "Registration cannot be verified right now. An unavailable read does not mean the token was never registered."
        : data.status === "stale" ? "Stale registration checkpoint. Current lifecycle and trading are unverified."
        : data.launches.length ? "Creation confirmed at the indexed checkpoint. Trading and claims remain separately gated." : "No registration at this discovery checkpoint. Market verification is pending or temporarily unavailable."}</p>
      {data.status === "ready" && data.launches[0] && <TokenArtwork symbol={data.launches[0].symbol} projectURI={data.launches[0].projectURI} />}
      {data.status !== "unavailable" && data.launches[0] && <TokenMarket token={address} symbol={data.launches[0].symbol}>
        {trading && data.status === "ready" ? <ProductionLifecycleWallet token={data.launches[0].token} curve={data.launches[0].initialCurve} symbol={data.launches[0].symbol}/> : null}
      </TokenMarket>}
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
