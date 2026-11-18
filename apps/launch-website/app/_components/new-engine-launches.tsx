"use client";

import Link from "next/link";
import { useState } from "react";
import { describeCurveLifecycle, hasCurveRegistration, type CurveLaunch, type NewEngineDirectory } from "../../lib/curve-lifecycle";
import { robinhoodExplorer } from "./launch-evidence";
import { ChainTime } from "./launch-freshness";
import { CreatorLink } from "./creator-link";
import { TokenArtwork } from "./token-artwork";

function units(wei: string) {
  const padded = wei.padStart(19, "0");
  const whole = BigInt(padded.slice(0, -18)).toLocaleString("en-US");
  const fraction = padded.slice(-18).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function LifecycleEvidence({ launch }: { launch: CurveLaunch }) {
  const lifecycle = describeCurveLifecycle(launch);
  if (lifecycle.stage === "active" || lifecycle.stage === "graduating") {
    const observed = lifecycle.observation;
    return <>
      <dt>Current curve</dt><dd><code className="lpAddress">{observed.engine}</code> · V{observed.version}</dd>
      <dt>Sold</dt><dd>{units(observed.soldWei)} / {units(observed.targetSoldWei)} tokens</dd>
      <dt>ETH backing</dt><dd>{units(observed.backingWei)} / {units(observed.targetBackingWei)} ETH</dd>
      <dt>Curve observation</dt><dd>Block {observed.at.blockNumber} · <ChainTime value={observed.at.timestamp} /></dd>
    </>;
  }
  if (lifecycle.stage === "graduated") {
    const { market, receipt, version } = lifecycle.observation;
    return <>
      <dt>Graduation receipt</dt><dd><a href={`${robinhoodExplorer}/tx/${receipt.transactionHash}`}>Block {receipt.blockNumber} · log {receipt.logIndex}</a> · V{version}</dd>
      <dt>PoolManager</dt><dd><code className="lpAddress">{market.poolManager}</code></dd>
      <dt>Pool ID</dt><dd><code className="lpAddress">{market.poolId}</code></dd>
      <dt>Pool key</dt><dd>ETH / token · {market.poolKey.fee / 10_000}% fee · tick spacing {market.poolKey.tickSpacing} · hook <code className="lpAddress">{market.poolKey.hooks}</code></dd>
      <dt>Starting deposits</dt><dd>{units(market.nativeDepositedWei)} ETH · {units(market.tokenDepositedWei)} tokens</dd>
      <dt>Initial position</dt><dd>#{market.positionId} · <code className="lpAddress">{market.positionManager}</code></dd>
      <dt>Observed owner</dt><dd><code className="lpAddress">{market.owner}</code></dd>
      <dt>Position liquidity</dt><dd>{market.liquidity}</dd>
    </>;
  }
  return <><dt>Curve and v4 state</dt><dd>Unverified</dd></>;
}

export function NewEngineLaunches({ directory }: { directory: NewEngineDirectory }) {
  const [query, setQuery] = useState("");
  const launches = directory.status === "ready"
    ? directory.launches.filter(({ registration }) => hasCurveRegistration(registration)) : [];
  const search = query.trim().toLowerCase();
  const visible = launches.filter(({ registration }) => [registration.name, registration.symbol, registration.token, registration.creator]
    .some((value) => value.toLowerCase().includes(search)));
  return <section className="lpProjectLink" aria-label="New RMT Launch engine">
    <div className="lpDiscoveryToolbar"><label className="rmtSearch lpSearch"><span aria-hidden="true">⌕</span>
      <input type="search" aria-label="Search launches" placeholder="Search name, ticker or contract address" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <span className="lpDiscoveryCount">{directory.status === "ready" ? `${launches.length} verified new-engine ${launches.length === 1 ? "launch" : "launches"}` : "New-engine launches"}</span></div>
    {directory.status === "prelaunch" && <section className="lpEmpty lpForm"><span className="lpPill">Prelaunch</span><h2>No new launches yet</h2>
      <p>The new RMT Launch engine is in prelaunch. Prepare a token draft while creation is disabled.</p><Link className="lpButton lpSecondary" href="/create-token" prefetch={false}>Prepare a token draft</Link></section>}
    {directory.status === "unavailable" && <section className="lpEmpty lpForm"><h2>Launch evidence unavailable</h2><p>We could not verify the new-engine feed. An unavailable read does not mean a token was never created.</p><p>Try refreshing this page. Wallet transactions remain separate and disabled.</p></section>}
    {directory.status === "ready" && launches.length === 0 && <section className="lpEmpty lpForm"><h2>No verified new-engine launches</h2><p>Confirmed registrations will appear here after canonical indexing. Historical tokens are shown separately.</p></section>}
    {launches.length > 0 && visible.length === 0 && <section className="lpEmpty lpForm"><h2>No launches match your search</h2><p>Try an exact contract address, token name or ticker.</p><button type="button" className="lpButton lpSecondary" onClick={() => setQuery("")}>Clear search</button></section>}
    <div className="lpCardGrid">{visible.map((launch) => {
      const { registration } = launch;
      return <article className="lpLaunchCard" key={`${registration.chainId}:${registration.factory}:${registration.token}`}>
        <div className="lpTokenHeading"><TokenArtwork symbol={registration.symbol} /><div><h3><Link href={`/launches/${registration.token}`} prefetch={false}>{registration.name}</Link></h3><span className="lpCardSymbol">${registration.symbol}</span></div></div>
        <span className="lpPill">{describeCurveLifecycle(launch).label}</span>
        <dl className="lpFacts lpProjectLink">
          <dt>Fixed supply</dt><dd>{units(registration.totalSupplyWei)} tokens</dd><dt>Creator</dt><dd><CreatorLink wallet={registration.creator} /></dd>
          <dt>Created</dt><dd><ChainTime value={registration.creation.timestamp} /></dd>
        </dl>
        <details><summary>Verified launch evidence</summary><dl className="lpFacts"><dt>Token address</dt><dd><a href={`${robinhoodExplorer}/address/${registration.token}`} className="lpAddress">{registration.token}</a></dd>
          <dt>Factory registration</dt><dd><a href={`${robinhoodExplorer}/tx/${registration.creation.transactionHash}`}>Block {registration.creation.blockNumber} · log {registration.creation.logIndex}</a></dd><LifecycleEvidence launch={launch} /><dt>Ethereum L1 finality</dt><dd>Unverified</dd></dl></details>
        <div className="lpCardFooter"><span>Robinhood Chain 4663</span><Link href={`/launches/${registration.token}`} prefetch={false}>View token →</Link></div>
      </article>;
    })}</div>
  </section>;
}
