import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { isLaunchAddress } from "../../../lib/launch-data";
import { FixtureLaunchDetails, FixtureTransactionRecovery } from "../../_components/fixture-launches";
import { configuredCurveFixture } from "../../../lib/server/curve-fixture";
import { readFixtureLaunches } from "../../../lib/server/fixture-discovery";
import { configuredProductionDiscovery, productionDirectory } from "../../../lib/server/production-discovery";
import { launchMetadata, readCreator, tokenDiscovery } from "../../../lib/server/social-pages";
import { LaunchProvenance } from "../../_components/launch-provenance";
import { TokenArtwork } from "../../_components/token-artwork";
import { CreatorLink } from "../../_components/creator-link";
import { configuredProductionFinancialPage } from "../../../lib/server/production-financial";
import { ProductionLifecycleWallet } from "../../_components/production-lifecycle-wallet";
import { readMarketResponse } from "../../../lib/server/market-response";
import { TokenMarket } from "../../_components/token-market";
import { TokenActions, TokenDescription } from "../../_components/token-project-info";

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
    const launch = data.status !== "unavailable" ? data.launches[0] : undefined;
    // Page presence reflects the approved configuration. Fresh state is still
    // mandatory in the transaction handlers before a wallet request is prepared.
    const trading = configuredProductionFinancialPage(requestHeaders, "trading");
    const creator = launch ? await readCreator("creator", launch.creator) : null;
    const evidence = directory.status === "ready" ? directory.launches[0]
      : directory.status === "stale" ? directory.history[0] : undefined;
    return <section className="tpPage">
      <Link className="tpBack" href="/" prefetch={false}>← Launches</Link>
      {launch ? <header className="tpHeader">
        <div className="tpIdentity">
          <TokenArtwork symbol={launch.symbol} projectURI={launch.projectURI} />
          <div>
            <div className="tpName"><h1>{launch.name}</h1><span className="tpTicker">${launch.symbol}</span></div>
            <div className="tpByline"><span>By <CreatorLink wallet={launch.creator} label={creator?.status === "ready" ? creator.profile.username ? "@" + creator.profile.username : creator.profile.displayName || undefined : undefined} /></span><span>Robinhood Chain</span></div>
          </div>
        </div>
        <TokenActions token={launch.token} symbol={launch.symbol} />
      </header> : <header className="lpPageHeading"><h1>Token details</h1></header>}
      {(data.status !== "ready" || !launch) && <p className="tpReadStatus" role="status">{data.status === "unavailable" ? "Token data is temporarily unavailable. Refresh to try again."
        : data.status === "stale" ? "Showing the last update. Trading needs a fresh quote."
        : "This token is still being indexed. Check again shortly."}</p>}
      {launch && <TokenMarket token={address} symbol={launch.symbol}>
        {trading ? <ProductionLifecycleWallet token={launch.token} curve={launch.initialCurve} symbol={launch.symbol}/> : null}
      </TokenMarket>}
      {launch && <TokenDescription symbol={launch.symbol} projectURI={launch.projectURI} />}
      {evidence && <details className="tpDetails">
        <summary>Contract details <span>Addresses and on-chain records</span></summary>
        {data.status === "stale" && <p className="tpReadStatus">These records are from an earlier update.</p>}
        <LaunchProvenance launch={evidence} />
        {launch?.treasury && <dl className="lpFacts"><dt>Project treasury</dt><dd className="lpAddress">{launch.treasury}</dd><dt>Treasury allocation</dt><dd>{launch.treasuryShareBps / 100}% of total collected fees</dd></dl>}
      </details>}
    </section>;
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
