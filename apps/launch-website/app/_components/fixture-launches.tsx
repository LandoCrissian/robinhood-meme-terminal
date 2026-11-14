import Link from "next/link";
import type { FixtureDiscovery, FixtureLaunch } from "../../lib/server/fixture-discovery";
import { ChainTime } from "./launch-freshness";
import { TokenArtwork } from "./token-artwork";

export function FixtureLaunches({ directory }: { directory: FixtureDiscovery }) {
  return <section className="lpNotice lpProjectLink" aria-label="New RMT Launch engine">
    <span className="lpPill">Anvil 31337 · Synthetic test only</span>
    {directory.status === "unavailable" ? <span>New-engine evidence is unavailable.</span> : <>
      {directory.launches.length === 0 && <span>No verified new-engine launches at this checkpoint.</span>}
      {directory.launches.map(({ token, name, symbol }) => <Link href={`/launches/${token}`} prefetch={false} key={token}>{name} · {symbol}</Link>)}
      <span>Indexed through block {directory.checkpoint.blockNumber} · <ChainTime value={directory.checkpoint.timestamp} /></span>
    </>}
  </section>;
}

export function FixtureLaunchDetails({ launch }: { launch: FixtureLaunch }) {
  const fee = launch.creationFee;
  return <>
    <Link className="lpBack" href="/" prefetch={false}>← Launches</Link>
    <header className="lpPageHeading"><div className="lpTokenHeading"><TokenArtwork symbol={launch.symbol} />
      <div><h1>{launch.name}</h1><p>{launch.symbol} · Anvil 31337 · Synthetic test only</p></div></div>
      <span className="lpPill">Indexed and verified</span></header>
    <section className="lpPanel lpForm">
      <h2>New-engine creation evidence</h2>
      <dl className="lpFacts">
        <dt>Token</dt><dd><code className="lpAddress">{launch.token}</code></dd>
        <dt>Creator</dt><dd><code className="lpAddress">{launch.creator}</code></dd>
        <dt>Initial curve</dt><dd><code className="lpAddress">{launch.initialCurve}</code></dd>
        <dt>Fixed supply</dt><dd>{(BigInt(launch.totalSupplyWei) / 10n ** 18n).toLocaleString("en-US")} tokens</dd>
        <dt>Opening backing</dt><dd>{launch.opening.backingWei} ETH</dd>
        <dt>Opening curve inventory</dt><dd>{(BigInt(launch.opening.inventoryWei) / 10n ** 18n).toLocaleString("en-US")} tokens</dd>
        <dt>Project URI</dt><dd>{launch.projectURI || "None"}</dd>
        <dt>Treasury</dt><dd><code className="lpAddress">{launch.treasury || "None"}</code></dd>
        <dt>Treasury fee share</dt><dd>{launch.treasuryShareBps / 100}% of collected curve fees</dd>
        <dt>Creation fee</dt><dd>0.0004 test ETH · fee receipt log {fee.logIndex}</dd>
        <dt>Creation transaction</dt><dd><code className="lpAddress">{launch.creation.transactionHash}</code></dd>
        <dt>Creation block and log</dt><dd>{launch.creation.blockNumber} · log {launch.creation.logIndex} · <ChainTime value={launch.creation.timestamp} /></dd>
        <dt>Current curve state</dt><dd>Unverified</dd>
      </dl>
    </section>
  </>;
}
