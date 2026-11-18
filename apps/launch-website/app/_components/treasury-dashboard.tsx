"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { isProjectTreasurySnapshot, projectTreasuryReadPath, treasuryAddress, type ProjectTreasurySnapshot } from "../../lib/project-treasury";
import { earningsAmount } from "../../lib/earnings";
import { MyLaunchesNav } from "./my-launches-nav";
import { TreasuryWalletControls } from "./treasury-wallet-controls";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const time = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Timestamp unavailable";
const amount = (raw: string | null, native = true) => raw === null ? "Unavailable" : native ? earningsAmount(raw) : raw + " base units";
export function TreasuryDashboard({ fixture = false, initialTreasury = "" }: { fixture?: boolean; initialTreasury?: string }) {
  const [input, setInput] = useState(initialTreasury), [snapshot, setSnapshot] = useState<ProjectTreasurySnapshot | null>(null);
  const [address, setAddress] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [stale, setStale] = useState(false);
  const generation = useRef(0), active = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; active.current?.abort(); }, []);
  useEffect(() => { if (treasuryAddress(initialTreasury)) void load(initialTreasury); }, []);
  async function load(next: string) {
    if (!treasuryAddress(next)) { setMessage("Enter the complete project treasury contract address."); return; }
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const version = ++generation.current; setBusy(true); setMessage("");
    if (!same(address, next)) { setSnapshot(null); setStale(false); }
    setAddress(next);
    try {
      const url = new URL(projectTreasuryReadPath, window.location.origin); url.searchParams.set("address", next);
      const response = await fetch(url.pathname + url.search, { cache: "no-store", redirect: "error",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
      const payload: unknown = await response.json();
      if (!response.ok || !isProjectTreasurySnapshot(payload) || !same(payload.treasury, next) || !fixture) throw Error("Treasury evidence unavailable");
      if (version !== generation.current) return;
      setSnapshot(payload); setStale(false);
    } catch { if (version === generation.current) { setStale(true); setMessage("Verified treasury evidence is unavailable. A failed read does not establish a zero balance or a missing deployment."); } }
    finally { if (version === generation.current) setBusy(false); }
  }
  function lookup(event: FormEvent) { event.preventDefault(); void load(input.trim()); }
  const purchases = snapshot?.events.filter(event => event.event === "PurchaseExecuted") ?? [];
  return <>
    <header className="lpPageHeading"><div><h1>Project Treasury</h1><p>Your project&apos;s funds, permissions and verified fee receipts.</p></div></header>
    <MyLaunchesNav active="treasury" />
    <form className="lpPanel lpForm lpEarningsLookup" aria-label="Find project treasury" onSubmit={lookup}>
      <label htmlFor="project-treasury-address">Project treasury address<input id="project-treasury-address" value={input} maxLength={42} placeholder="0x…" spellCheck={false} autoComplete="off" onChange={e => setInput(e.target.value)} /></label>
      <button className="lpButton" type="submit" disabled={busy}>{busy ? "Checking evidence…" : "View treasury"}</button>
      <small>Public lookup. Wallet connection grants no treasury authority.</small>
    </form>
    <p className="lpInlineNotice">{fixture ? "Isolated chain 31337 · synthetic assets. No production financial execution."
      : "Read-only. The optional project treasury module is not deployed or activated for production."}</p>
    {message && <p className="lpNotice lpError" role="status">{message}</p>}
    {busy && !snapshot && <div className="lpSkeleton" role="status">Verifying treasury runtime, controller, project and balances…</div>}
    {!snapshot && !busy && !message && <section className="lpEmpty"><div><h2>A treasury belongs to one project</h2><p>Enter its deployed contract address to inspect verified funds and controller permissions. Predicting an address does not deploy or fund it.</p><Link className="lpBack" href="/create-token" prefetch={false}>Optional treasury setup →</Link></div></section>}
    {snapshot && <div className="lpStack lpTreasuryDashboard" aria-label="Verified project treasury">
      <section className="lpPanel lpForm"><div className="lpTreasuryHeading"><h2>Verified treasury</h2><span className="lpPill">{snapshot.project.status === "bound" ? "Project bound" : "Awaiting verified project binding"}</span></div>
        <code className="lpAddress">{snapshot.treasury}</code>
        <dl className="lpFacts"><dt>Creator</dt><dd className="lpAddress">{snapshot.creator}</dd><dt>Controller</dt><dd className="lpAddress">{snapshot.controller}</dd>
          <dt>Controller profile</dt><dd>{snapshot.controllerKind} · epoch {snapshot.controllerEpoch}</dd>
          <dt>Treasury fee allocation</dt><dd>{snapshot.treasuryShareBps} / 10,000 of eligible fees · {new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(snapshot.treasuryShareBps * 100 / 9000)}% of the project&apos;s 90% share</dd>
          <dt>Project token</dt><dd>{snapshot.project.token ? <Link className="lpAddress" href={`/launches/${snapshot.project.token}`} prefetch={false}>{snapshot.project.token}</Link> : "No verified token binding"}</dd>
          <dt>Curve / liquidity status</dt><dd>{snapshot.project.graduated ? "Graduated · original LP principal remains locked" : snapshot.project.status === "bound" ? "Bonding curve" : "Project not bound"}</dd>
        </dl>
        <p className="lpInlineNotice">{stale ? "Stale retained observation. " : ""}Observed synthetic block {snapshot.observed.blockNumber} · {time(snapshot.observed.timestamp)}. These results do not establish production L1 finality.</p>
        <button type="button" className="lpButton lpSecondary" disabled={busy} onClick={() => void load(snapshot.treasury)}>Refresh treasury evidence</button>
      </section>
      <div className="lpEarningsSummary"><section className="lpPanel"><span>Purchase permission</span><strong>{snapshot.purchases.enabled ? "Enabled" : "OFF"}</strong></section>
        <section className="lpPanel"><span>Purchase execution</span><strong>{snapshot.purchases.available ? "Constrained" : "Unavailable"}</strong></section></div>
      <p className="lpInlineNotice">{snapshot.purchases.reason} Purchase permission does not create a keeper, submit a trade, guarantee income or stop incoming funding when disabled.</p>
      <section className="lpPanel lpForm"><h2>Actual held assets</h2><p>Current balances and cumulative funding are separate. Token amounts remain in base units unless verified decimal information is available.</p>
        {snapshot.assets.map(asset => <article className="lpTreasuryAsset lpForm" key={asset.address ?? "native"} aria-label={`${asset.symbol} treasury accounting`}>
          <h3>{asset.symbol}</h3>{asset.address && <code className="lpAddress">{asset.address}</code>}
          <dl className="lpFacts"><dt>Held now</dt><dd>{amount(asset.heldWei, asset.address === null)}</dd><dt>Reserved for noticed withdrawals</dt><dd>{amount(asset.reservedWei, asset.address === null)}</dd>
            <dt>Unreserved balance</dt><dd>{amount(asset.availableWei, asset.address === null)}</dd><dt>Unreconciled positive balance delta</dt><dd>{amount(asset.unclassifiedWei, asset.address === null)}</dd>
            <dt>Manual funding · cumulative</dt><dd>{amount(asset.manualWei, asset.address === null)}</dd><dt>Payer-declared royalties · cumulative</dt><dd>{amount(asset.declaredFundingWei, asset.address === null)}</dd>
            <dt>Unsolicited funding reconciled · cumulative</dt><dd>{amount(asset.unsolicitedWei, asset.address === null)}</dd><dt>Actual fee receipts · cumulative</dt><dd>{amount(asset.feesReceivedWei, asset.address === null)}</dd>
            <dt>Purchased tokens · cumulative</dt><dd>{amount(asset.purchasedWei, false)}</dd><dt>Withdrawn · cumulative</dt><dd>{amount(asset.withdrawnWei, asset.address === null)}</dd>
          </dl><p className="lpCreatorHelp">Support: {asset.support}. A deposit label does not independently prove a marketplace royalty payment. Unsupported or uncertain assets are never treated as approved spending funds.</p>
        </article>)}
      </section>
      <section className="lpPanel lpForm"><h2>Project fee credits</h2><p>The treasury claims as the beneficiary contract. Its controller&apos;s EOA and Safe owners do not inherit those credits.</p>
        <dl className="lpFacts"><dt>Curve ETH claimable</dt><dd>{amount(snapshot.earnings.curveNativeWei)}</dd><dt>LP ETH claimable</dt><dd>{amount(snapshot.earnings.lpNativeWei)}</dd>
          <dt>LP token claimable</dt><dd>{amount(snapshot.earnings.lpTokenWei, false)}</dd><dt>Credit evidence</dt><dd>{snapshot.earnings.status}</dd></dl>
        <p>Collection and claims are separate. Earned LP fees exclude other positions and never withdraw original liquidity principal.</p>
      </section>
      <section className="lpPanel lpForm"><h2>Purchase policy</h2><dl className="lpFacts"><dt>Maximum per transaction</dt><dd>{earningsAmount(snapshot.purchases.rules.perTransactionWei)}</dd>
        <dt>Maximum per period</dt><dd>{earningsAmount(snapshot.purchases.rules.perPeriodWei)}</dd><dt>Minimum accumulated ETH</dt><dd>{earningsAmount(snapshot.purchases.rules.minimumWei)}</dd>
        <dt>Cooldown / period</dt><dd>{snapshot.purchases.rules.cooldownSeconds}s / {snapshot.purchases.rules.periodSeconds}s</dd>
        <dt>Slippage / impact bounds</dt><dd>{snapshot.purchases.rules.maxSlippageBps} / {snapshot.purchases.rules.maxImpactBps} basis points</dd></dl>
        <p>No swaps are submitted here. Version 1 execution remains unavailable without an independently supported reference price. Funds stay held.</p>
        <h3>Verified purchase history</h3>{!purchases.length ? <p>{snapshot.history.indexed ? "No purchase events at the indexed checkpoint." : "Purchase history is pending or unavailable; no activity is invented."}</p>
          : <ul className="lpTreasuryHistory">{purchases.map(event => <li key={`${event.transactionHash}:${event.logIndex}`}><span>{event.event} · {event.amountWei ?? "Unknown amount"} base units</span><code className="lpAddress">{event.transactionHash}</code></li>)}</ul>}
      </section>
      <TreasuryWalletControls key={`${snapshot.treasury}:${snapshot.controllerEpoch}`} snapshot={snapshot} fixture={fixture} onChanged={() => void load(snapshot.treasury)} />
      <section className="lpPanel lpForm"><h2>Funding and controller history</h2><p>History: {snapshot.history.status}{snapshot.history.checkpoint ? ` · checkpoint ${snapshot.history.checkpoint.blockNumber}` : ""}. Events are observations from the named chain, not proof of royalty enforcement.</p>
        <ul className="lpTreasuryHistory">{snapshot.events.map(event => <li key={`${event.transactionHash}:${event.logIndex}`}><strong>{event.event}</strong><span>Block {event.blockNumber} · {time(event.timestamp)}</span>
          {event.amountWei !== undefined && <span>{event.amountWei} base units{event.asset ? ` · ${event.asset}` : ""}</span>}<code className="lpAddress">{event.transactionHash}</code></li>)}</ul>
        {!snapshot.events.length && <p>No verified history is available in this reading window.</p>}
      </section>
      {snapshot.notices.map((notice, i) => <p key={i} className="lpInlineNotice">{notice}</p>)}
    </div>}
  </>;
}
