"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { describeCurveLifecycle, hasCurveRegistration, type NewEngineDirectory } from "../../lib/curve-lifecycle";
import { TokenArtwork } from "./token-artwork";

function units(wei: string) {
  const padded = wei.padStart(19, "0");
  const whole = BigInt(padded.slice(0, -18)).toLocaleString("en-US");
  const fraction = padded.slice(-18).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

const creationDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export function NewEngineLaunches({ directory }: { directory: NewEngineDirectory }) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const launches = directory.status === "ready"
    ? directory.launches.filter(({ registration }) => hasCurveRegistration(registration)) : [];
  const search = query.trim().toLowerCase();
  const visible = launches.filter(({ registration }) => [registration.name, registration.symbol, registration.token, registration.creator]
    .some((value) => value.toLowerCase().includes(search)));
  const clearSearch = () => { setQuery(""); input.current?.focus(); };
  return <section className="lpProjectLink" aria-label="New RMT Launch engine">
    <div className="lpDiscoveryToolbar"><div className="rmtSearch lpSearch"><span aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg></span>
      <input ref={input} type="search" aria-label="Search launches" placeholder="Search name, ticker or address" value={query} onChange={(event) => setQuery(event.target.value)} />
      {query && <button type="button" className="lpSearchClear" aria-label="Clear search" onClick={clearSearch}>×</button>}</div>
      <span className="lpDiscoveryCount" role="status">{directory.status === "ready"
        ? `${visible.length}${search ? ` of ${launches.length}` : ""} ${launches.length === 1 ? "launch" : "launches"}` : "New launches"}</span></div>
    {directory.status === "prelaunch" && <section className="lpEmpty lpForm lpLaunchEmpty"><h2>Launches coming soon</h2>
      <p>Token creation, trading and fee claims are not yet available.</p></section>}
    {directory.status === "unavailable" && <section className="lpEmpty lpForm"><h2>Launch feed unavailable</h2><p>We could not verify the new-engine feed. Refresh to try again.</p><p>Missing feed data does not mean a token was never created. Wallet transactions remain disabled.</p></section>}
    {directory.status === "ready" && launches.length === 0 && <section className="lpEmpty lpForm lpLaunchEmpty"><h2>No launches yet</h2><p>Verified new-engine projects will appear here after on-chain registration and indexing.</p></section>}
    {launches.length > 0 && visible.length === 0 && <section className="lpEmpty lpForm"><h2>No launches match your search</h2><p>Try a token name, ticker or exact contract address.</p></section>}
    <div className="lpCardGrid">{visible.map((launch) => {
      const { registration } = launch;
      const lifecycle = describeCurveLifecycle(launch);
      return <article className="lpLaunchCard" key={`${registration.chainId}:${registration.factory}:${registration.token}`}>
        <div className="lpTokenHeading"><TokenArtwork symbol={registration.symbol} /><div><h3><Link href={`/launches/${registration.token}`} prefetch={false}>{registration.name}</Link></h3><span className="lpCardSymbol">${registration.symbol}</span></div></div>
        <span className="lpPill lpLifecycle" data-stage={lifecycle.stage}>{lifecycle.label}</span>
        <dl className="lpCardMetrics">
          <div><dt>Created · UTC</dt><dd><time dateTime={registration.creation.timestamp} title={registration.creation.timestamp}>{creationDate.format(new Date(registration.creation.timestamp))}</time></dd></div>
          {(lifecycle.stage === "active" || lifecycle.stage === "graduating") && <>
            <div><dt>Observed backing</dt><dd>{units(lifecycle.observation.backingWei)} / {units(lifecycle.observation.targetBackingWei)} ETH</dd></div>
            <div><dt>Curve tokens sold</dt><dd>{units(lifecycle.observation.soldWei)} / {units(lifecycle.observation.targetSoldWei)}</dd></div>
          </>}
          {lifecycle.stage === "graduated" && <>
            <div><dt>Initial ETH deposit</dt><dd>{units(lifecycle.observation.market.nativeDepositedWei)} ETH</dd></div>
            <div><dt>Pool fee</dt><dd>{lifecycle.observation.market.poolKey.fee / 10_000}%</dd></div>
          </>}
        </dl>
        <div className="lpCardFooter lpCardFooterAction"><Link href={`/launches/${registration.token}`} prefetch={false}>View token →</Link></div>
      </article>;
    })}</div>
  </section>;
}
