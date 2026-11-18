"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { earningsAddress, earningsAmount, earningsReadPath, earningsWei, sameEarningsAddress as same,
  type EarningsDirectory, type EarningsHistory, type EarningsRegistration, type EarningsResponse } from "../../lib/earnings";
import type { EarningsContractSnapshot, FactoryCreationFees } from "../../lib/server/earnings-contracts";
import { useAccount } from "./account-provider";
import { shortWallet } from "./wallet-account";

const TestEarningsClaimWallet = dynamic(() => import("./earnings-claim-wallet").then(m => m.EarningsClaimWallet), { ssr: false });
const unavailable = "Earnings unavailable — a failed read does not mean zero.";
type Checked = { status: "loading" | "unavailable" } | { status: "ready"; value: EarningsContractSnapshot; refreshing?: boolean };
async function get(path: string, signal?: AbortSignal) {
  const r = await fetch(path, { cache: "no-store", redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]) });
  if (!r.ok) throw new Error("Read unavailable");
  return r.json();
}
function validSnapshot(raw: unknown, registration: EarningsRegistration, recipient: string): raw is EarningsContractSnapshot {
  try {
    const s = raw as EarningsContractSnapshot;
    return s.status === "ready" && s.chainId === registration.chainId && same(s.token, registration.token) && same(s.beneficiary, recipient)
      && same(s.curve.ledger, registration.revenueLedger) && same(s.rights.creator, registration.creator)
      && s.rights.treasuryShareBps === registration.treasuryShareBps && s.rights.roles.length > 0
      && [s.curve.claimableNativeWei, s.curve.accruedNativeWei, s.curve.claimedNativeWei].every(earningsWei)
      && (s.lp.status === "not-graduated" || s.lp.status === "ready" && [s.lp.claimableNativeWei, s.lp.claimableTokenWei,
        s.lp.claimedNativeWei, s.lp.claimedTokenWei, s.lp.uncollectedNativeWei, s.lp.uncollectedTokenWei].every(earningsWei));
  } catch { return false; }
}
const pair = (eth: string, token: string, symbol: string) => <>{earningsAmount(eth)} <span aria-hidden="true">·</span> {earningsAmount(token, symbol)}</>;

export function EarningsDashboard({ fixture = false, fixtureFactory }: { fixture?: boolean; fixtureFactory?: string }) {
  const { session } = useAccount();
  const signedIn = session.authenticated ? session.account.walletAddress : "";
  const [input, setInput] = useState(""), [recipient, setRecipient] = useState("");
  const [directory, setDirectory] = useState<EarningsDirectory | null>(null), [rows, setRows] = useState<EarningsRegistration[]>([]);
  const [history, setHistory] = useState<EarningsHistory | null>(null), [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false), [historyLoading, setHistoryLoading] = useState(false), [checks, setChecks] = useState<Record<string, Checked>>({});
  const [factoryFees, setFactoryFees] = useState<FactoryCreationFees | "loading" | "unavailable" | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0), active = useRef<AbortController | null>(null);
  useEffect(() => { if (signedIn) setInput(signedIn); }, [signedIn]);
  useEffect(() => () => active.current?.abort(), []);
  async function load(wallet: string, after?: string) {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const current = ++generation.current;
    setLoading(true); setMessage("");
    if (!after) { setDirectory(null); setRows([]); setChecks({}); setHistory(null); setFactoryFees(null); setRevision(v => v + 1); }
    try {
      const url = new URL(earningsReadPath, window.location.origin); url.searchParams.set("recipient", wallet);
      if (after) url.searchParams.set("after", after);
      const result = await get(url.pathname + url.search, controller.signal) as EarningsResponse;
      if (result.status === "unavailable" || result.profile !== "rmt-creator-earnings-v1" || !same(result.recipient, wallet)
        || result.launches.length > 50 || !Array.isArray(result.launches)
        || result.chainId !== (fixture ? 31337 : 4663)) throw new Error("Discovery unavailable");
      if (current !== generation.current) return;
      setDirectory(result); setRows(previous => {
        const combined = after ? [...previous, ...result.launches] : result.launches;
        if (new Set(combined.map(row => row.token.toLowerCase())).size !== combined.length) { setMessage("The indexing page changed. Refresh the original lookup."); return previous; }
        return combined;
      });
      if (!after) setHistory(result.historical);
    } catch { if (current === generation.current) setMessage(after ? "The next page is unavailable or its checkpoint changed. Refresh to start a new lookup." : unavailable); }
    finally { if (current === generation.current) setLoading(false); }
  }
  function lookup(event: FormEvent) {
    event.preventDefault();
    if (!earningsAddress(input.trim())) { setMessage("Enter a complete beneficiary wallet address."); return; }
    const wallet = input.trim().toLowerCase(); setRecipient(wallet); void load(wallet);
  }
  async function checkProject(row: EarningsRegistration) {
    const version = generation.current, key = row.token.toLowerCase();
    setChecks(previous => ({ ...previous, [key]: previous[key]?.status === "ready" ? { ...previous[key], refreshing: true } : { status: "loading" } }));
    try {
      const r = await get(`${earningsReadPath}/${row.token}?recipient=${recipient}`) as { status: string; snapshot: unknown };
      if (r.status !== "ready" || !validSnapshot(r.snapshot, row, recipient)) throw new Error("Invalid contract state");
      if (version === generation.current) setChecks(previous => ({ ...previous, [key]: { status: "ready", value: r.snapshot as EarningsContractSnapshot } }));
    } catch { if (version === generation.current) setChecks(previous => ({ ...previous, [key]: { status: "unavailable" } })); }
  }
  async function checkFactory() {
    const version = generation.current; setFactoryFees("loading");
    try {
      const r = await get(`${earningsReadPath}/factory?recipient=${recipient}`) as { status: string; factoryFees: FactoryCreationFees };
      if (r.status !== "ready" || !same(r.factoryFees.beneficiary, recipient) || r.factoryFees.scope !== "factory-global"
        || !earningsWei(r.factoryFees.availableNativeWei) || !earningsAddress(r.factoryFees.recipient)) throw new Error("Factory credit unavailable");
      if (version === generation.current) setFactoryFees(r.factoryFees);
    } catch { if (version === generation.current) setFactoryFees("unavailable"); }
  }
  async function moreHistory() {
    if (!history?.nextCursor || historyLoading) return;
    const version = generation.current;
    setHistoryLoading(true);
    try {
      const next = await get(`${earningsReadPath}/history?recipient=${recipient}&after=${encodeURIComponent(history.nextCursor)}`) as EarningsHistory;
      if (next.status === "unavailable" || !Array.isArray(next.records) || next.records.length > 14) throw new Error("Historical page unavailable");
      if (version === generation.current) {
        const seen = new Set<string>();
        // Keep a finite reading window on phones. The cursor still traverses the
        // full history; refreshing the lookup returns to its first page.
        const previous = history.records.length >= 100 ? [] : history.records;
        const records = [...previous, ...next.records].filter(row => {
          const key = row.token.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true;
        });
        setHistory({ ...next, records });
      }
    } catch { if (version === generation.current) setMessage("Historical evidence is unavailable. Previously verified records remain visible."); }
    finally { setHistoryLoading(false); }
  }
  const verified = Object.values(checks).flatMap(check => check.status === "ready" ? [check.value] : []);
  const availableEth = verified.reduce((sum, s) => sum + BigInt(s.curve.claimableNativeWei) + (s.lp.status === "ready" ? BigInt(s.lp.claimableNativeWei) : 0n), 0n);
  const claimedEth = verified.reduce((sum, s) => sum + BigInt(s.curve.claimedNativeWei) + (s.lp.status === "ready" ? BigInt(s.lp.claimedNativeWei) : 0n), 0n);
  return <>
    <header className="lpPageHeading"><div><Link href="/my-launches" className="lpBack" prefetch={false}>My Launches</Link><h1>Earnings</h1><p>Verified fee credits, paid to the wallet entitled to them.</p></div></header>
    <form className="lpPanel lpForm lpEarningsLookup" onSubmit={lookup} aria-label="Find beneficiary earnings">
      <label htmlFor="earnings-wallet">Beneficiary wallet<input id="earnings-wallet" value={input} onChange={e => setInput(e.target.value)} spellCheck={false} autoComplete="off" placeholder="0x…" maxLength={42} /></label>
      <button className="lpButton" type="submit" disabled={loading}>{loading ? "Checking evidence…" : "View earnings"}</button>
      <small>Public lookup. No wallet connection or sign-in required. Safe earnings belong to the Safe address.</small>
    </form>
    <p className="lpInlineNotice">{fixture ? "Isolated Anvil 31337 · synthetic ETH and tokens only." : "Robinhood Chain 4663 · read-only. Claims and wallet signing are not activated."}</p>
    {fixture && fixtureFactory && <TestEarningsClaimWallet factory={fixtureFactory} beneficiary={recipient} recoveryOnly onSettled={(token?: string) => {
      const row = token && rows.find(candidate => same(candidate.token, token));
      if (row) void checkProject(row);
      if (!token && factoryFees && typeof factoryFees === "object") void checkFactory();
    }} />}
    {message && <p className="lpNotice lpError" role="status">{message}</p>}
    {loading && !directory && <div className="lpSkeleton" role="status">Loading recipient-aware registrations…</div>}
    {!recipient && <section className="lpEmpty"><div><h2>Your earnings, clearly accounted for</h2><p>Enter a creator, project treasury, Operations or Reserve address.</p></div></section>}
    {directory && <>
      <div className="lpEarningsSummary" aria-label="Checked project totals">
        <section className="lpPanel"><span>Available in checked projects</span><strong>{verified.length ? earningsAmount(availableEth.toString()) : "Not checked"}</strong></section>
        <section className="lpPanel"><span>Claimed in checked projects</span><strong>{verified.length ? earningsAmount(claimedEth.toString()) : "Not checked"}</strong></section>
      </div>
      <p className="lpInlineNotice">{verified.length} of {rows.length} loaded projects checked. Totals exclude unchecked projects, token-denominated fees and factory creation fees. {directory.nextCursor ? "More projects are available." : "End of this registration page set."}</p>
      <div className="lpEarningsCheckpoint"><span>{directory.status === "ready" ? "Indexed registrations" : "Stale indexing checkpoint"}</span><span>Block {directory.checkpoint.blockNumber} · {new Date(directory.checkpoint.timestamp).toLocaleString()}</span><span>{fixture ? "Local synthetic evidence" : "L2 observed · L1 finality unverified"}</span></div>
      {!rows.length && <section className="lpEmpty"><div><h2>No matching new-engine registrations at this checkpoint</h2><p>This is not a statement about unindexed launches or historical fee rights.</p></div></section>}
      <div className="lpEarningsProjects">{rows.map(row => {
        const check = checks[row.token.toLowerCase()], snapshot = check?.status === "ready" ? check.value : null;
        return <article className="lpPanel lpEarningsProject" key={row.token} aria-label={`${row.name} earnings`}>
          <header><div><Link href={`/launches/${row.token}`} prefetch={false}>{row.name}</Link><span>{row.symbol} · {row.beneficiaryRoles.join(" / ")}</span></div>
            <span className="lpPill">{snapshot ? snapshot.lp.status === "ready" ? "Graduated · locked LP" : "Curve fees" : "Contract read required"}</span></header>
          <div className="lpEarningsRecipient">Receiving wallet <code title={recipient}>{shortWallet(recipient)}</code></div>
          {snapshot ? <>
            <dl className="lpFacts"><dt>Available curve ETH</dt><dd>{earningsAmount(snapshot.curve.claimableNativeWei)}</dd>
              <dt>Curve ETH claimed</dt><dd>{earningsAmount(snapshot.curve.claimedNativeWei)}</dd>
              {snapshot.lp.status === "ready" && <><dt>Available LP credits</dt><dd>{pair(snapshot.lp.claimableNativeWei, snapshot.lp.claimableTokenWei, row.symbol)}</dd>
                <dt>LP fees claimed</dt><dd>{pair(snapshot.lp.claimedNativeWei, snapshot.lp.claimedTokenWei, row.symbol)}</dd>
                <dt>Position fees awaiting collection</dt><dd>{pair(snapshot.lp.uncollectedNativeWei, snapshot.lp.uncollectedTokenWei, row.symbol)}</dd></>}
            </dl>
            {snapshot.lp.status === "ready" && <p className="lpInlineNotice">Awaiting-collection amounts are gross fees earned by the original locked position. They are not this wallet&apos;s claimable balance. Other LPs&apos; fees are excluded.</p>}
            {fixture ? <TestEarningsClaimWallet key={`${recipient}:${revision}:${row.token}`} factory={row.factory} token={row.token} beneficiary={recipient} snapshot={snapshot} showRecovery={false} onSettled={() => void checkProject(row)} />
              : <button type="button" className="lpButton" disabled>Claims not active</button>}
            <button type="button" className="lpTextButton" disabled={check?.status === "ready" && check.refreshing} onClick={() => void checkProject(row)}>Refresh contract balances</button>
          </> : <><p className="lpInlineNotice" role="status">{check?.status === "loading" ? "Verifying contracts and beneficiary credits…" : check?.status === "unavailable" ? unavailable : "Check this project's immutable policy and current contract balances."}</p>
            <button type="button" className="lpButton lpSecondary" disabled={check?.status === "loading"} onClick={() => void checkProject(row)}>Check earnings for {row.symbol}</button></>}
          <details><summary>Fee policy & evidence</summary><div className="lpForm">
            <p>1% curve trading fee. Eligible curve fees and fees earned by the original 0.30% v4 position: 90% project / 5% Operations / 5% Reserve.</p>
            <p>Project treasury receives {Number(row.treasuryShareBps * 100 / 9000).toLocaleString(undefined, { maximumFractionDigits: 6 })}% of the project share. Recipients are committed onchain.</p>
            <dl className="lpFacts"><dt>Creator</dt><dd className="lpAddress">{row.creator}</dd><dt>Project treasury</dt><dd className="lpAddress">{row.treasury ?? "No independent treasury"}</dd>
              <dt>Token</dt><dd className="lpAddress">{row.token}</dd><dt>Original curve ledger</dt><dd className="lpAddress">{row.revenueLedger}</dd>
              <dt>Creation receipt</dt><dd className="lpAddress">{row.creation.transactionHash} · log {row.creation.logIndex}</dd>
              {snapshot && <><dt>Contract observation</dt><dd>Block {snapshot.observed.blockNumber}</dd><dt>Curve version</dt><dd>V{snapshot.engineVersion} · original ledger retained</dd>
                <dt>Curve accrued / claimed / available (wei)</dt><dd className="lpAddress">{snapshot.curve.accruedNativeWei} / {snapshot.curve.claimedNativeWei} / {snapshot.curve.claimableNativeWei}</dd></>}
            </dl>
            <p>Claims transfer only to the beneficiary. Collection and claims are separate transactions. No principal withdrawal, automatic transaction or claim-all bundle.</p>
          </div></details>
        </article>;
      })}</div>
      <div className="lpDraftActions">{directory.nextCursor && <button className="lpButton lpSecondary" disabled={loading} onClick={() => void load(recipient, directory.nextCursor!)}>Load more projects</button>}
        <button className="lpTextButton" disabled={loading} onClick={() => void load(recipient)}>Refresh verified lookup</button></div>
      <details className="lpPanel lpEarningsFactory"><summary>Operations creation-fee payout</summary><div className="lpForm">
        <p>One factory-wide balance, paid only to immutable RMT Operations. It is separate from project revenue and is never multiplied by the number of projects. Anyone may trigger its release.</p>
        {factoryFees && typeof factoryFees === "object" ? <>
          <dl className="lpFacts"><dt>Available factory-wide</dt><dd>{earningsAmount(factoryFees.availableNativeWei)}</dd><dt>Receiving Operations wallet</dt><dd className="lpAddress">{factoryFees.recipient}</dd></dl>
          {fixture ? <TestEarningsClaimWallet beneficiary={recipient} factoryFees={factoryFees} showRecovery={false} onSettled={() => void checkFactory()} /> : <button className="lpButton" disabled>Release not active</button>}
        </> : <><p role="status">{factoryFees === "loading" ? "Verifying factory credit…" : factoryFees === "unavailable" ? unavailable : "Factory claimed totals require complete payout event history and are not assumed to be zero."}</p>
          <button type="button" className="lpButton lpSecondary" disabled={factoryFees === "loading"} onClick={() => void checkFactory()}>Check creation fees</button></>}
      </div></details>
    </>}
    {history && <details className="lpPanel lpEarningsHistory"><summary>Historical registrations · separate fee contracts{history.records.length ? ` (${history.records.length})` : ""}</summary>
      <p>The new-engine earnings adapter does not support these historical fee contracts. No historical balance or current entitlement is inferred from a matching creator address.</p>
      {history.status !== "ready" && <p className="lpInlineNotice">{history.status === "stale" ? "Historical snapshot or stale relation evidence." : "Complete historical recipient discovery is unavailable."}</p>}
      <ul>{history.records.map(row => <li key={row.token}><strong>{row.name} · {row.symbol}</strong><span>V{row.version} · {row.roles.join(" / ")} · earnings unsupported</span><code className="lpAddress">{row.token}</code></li>)}</ul>
      {history.nextCursor && <><p>Up to 100 earlier records are retained in this reading window. Refresh the lookup to return to the beginning.</p><button className="lpButton lpSecondary" disabled={historyLoading} onClick={() => void moreHistory()}>{historyLoading ? "Loading historical evidence…" : history.records.length >= 100 ? "Next historical page" : "More historical registrations"}</button></>}
    </details>}
  </>;
}
