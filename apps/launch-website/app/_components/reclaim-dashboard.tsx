"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { keccak256, parseUnits } from "viem";
import { claimDelegatePin } from "../../lib/claim-profiles";
import { readActiveTestCreation } from "../../lib/test-creation-history";
import { isLocalTestWallet, isTransactionHash } from "../../lib/test-creation";
import { assertTestWalletBinding, connectTestWallet, subscribeTestWallet, testWalletErrorCode, type TestWallet } from "../../lib/test-wallet";
import { assertNoUnresolvedFinancialRequests } from "./treasury-wallet-controls";
import { isReclaimReview, isReclaimSnapshot, reclaimAddress, reclaimHash, reclaimReadPath, reclaimTestPath, reclaimVerificationMatches,
  reclaimFieldsDigest, sameReclaimHex, type ReclaimFields, type ReclaimOperation, type ReclaimReview, type ReclaimSnapshot, type ReclaimVerification } from "../../lib/reclaim";
import { assertNoPendingLifecycleForReclaim, listReclaimJournals, reclaimJournalTerminal, storeReclaimJournal, type ReclaimJournal } from "../../lib/reclaim-recovery";
import { MyLaunchesNav } from "./my-launches-nav";

const amount = (value: string) => {
  try { const n = BigInt(value), whole = n / 10n ** 18n, fraction = (n % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, ""); return whole + (fraction ? "." + fraction : ""); }
  catch { return "Unavailable"; }
};
const when = (value: string) => { const millis = /^[0-9]+$/.test(value) ? Number(value) * 1000 : Date.parse(value); return Number.isFinite(millis) ? new Date(millis).toLocaleString() : "Time unavailable"; };
const label = (operation: string) => operation.replaceAll("-", " ");
const tokens = (value: string) => { if (!/^(0|[1-9][0-9]{0,30})(\.[0-9]{1,18})?$/.test(value)) throw Error("Enter a positive token amount with at most 18 decimals."); return parseUnits(value, 18).toString(); };
const entries = (value: string) => value.split(",").map(item => item.trim());
const bounded = async (response: Response) => {
  const text = await response.text(); if (new TextEncoder().encode(text).byteLength > 262144) throw Error("Reclaim evidence exceeds its response bound."); return JSON.parse(text) as unknown;
};
async function post(body: object) {
  if (!isLocalTestWallet(window.location)) throw Error("Reclaim transactions are limited to the isolated local test build.");
  const response = await fetch(reclaimTestPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(45_000) });
  const payload = await bounded(response);
  if (!response.ok) throw Error(response.status === 429 ? "Evidence reads are limited. Preserve the original request." : "Reclaim request could not be verified. No wallet submission was requested.");
  return payload;
}
function intentFor(account: string) {
  const key = "rmt.reclaim.intent.v1:" + account.toLowerCase(), saved = localStorage.getItem(key);
  if (saved !== null) { if (!reclaimHash(saved)) throw Error("The campaign intent is invalid. Preserve its original recovery records."); return saved; }
  const bytes = crypto.getRandomValues(new Uint8Array(32)); const next = "0x" + [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  if (!reclaimHash(next)) throw Error("Campaign intent unavailable."); localStorage.setItem(key, next);
  if (localStorage.getItem(key) !== next) throw Error("Campaign intent could not be preserved."); return next;
}

export function ReclaimDashboard({ fixture = false, initialCampaign = "" }: { fixture?: boolean; initialCampaign?: string }) {
  const [campaignInput, setCampaignInput] = useState(initialCampaign), [snapshot, setSnapshot] = useState<ReclaimSnapshot | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState(""), [stale, setStale] = useState(false), [message, setMessage] = useState("");
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [wallet, setWallet] = useState<TestWallet | null>(null);
  const [review, setReview] = useState<ReclaimReview | null>(null), [journals, setJournals] = useState<ReclaimJournal[]>([]), [journalKey, setJournalKey] = useState(""), [manualHash, setManualHash] = useState("");
  const [safeActor, setSafeActor] = useState(""), [collection, setCollection] = useState(""), [tokenIds, setTokenIds] = useState(""), [quantities, setQuantities] = useState("1");
  const [controller, setController] = useState(""), [rewardUnits, setRewardUnits] = useState("5"), [walletCap, setWalletCap] = useState("4"), [fundUnits, setFundUnits] = useState("2000");
  const [collectionCap, setCollectionCap] = useState("32"), [collectionWalletCap, setCollectionWalletCap] = useState("4"), [nextController, setNextController] = useState("");
  const generation = useRef(0), revision = useRef(0), lock = useRef(false), active = useRef<AbortController | null>(null);
  const selected = useRef("");
  const actor = safeActor || wallet?.account || "";
  const invalidate = () => { revision.current++; setReview(null); setMessage(""); };
  const refreshJournals = () => { if (fixture) setJournals(listReclaimJournals(localStorage)); };
  useEffect(() => { setReady(true); if (fixture) { try { refreshJournals(); } catch (error) { setMessage(error instanceof Error ? error.message : "Recovery unavailable."); } } }, []);
  useEffect(() => () => { generation.current++; revision.current++; active.current?.abort(); }, []);
  useEffect(() => { if (reclaimAddress(initialCampaign)) void load(initialCampaign); }, []);
  useEffect(() => {
    if (!wallet) return;
    return subscribeTestWallet(wallet, () => { revision.current++; setWallet(null); setReview(null); setMessage("Wallet account or network changed. Original submitted requests remain recoverable."); });
  }, [wallet]);
  async function run(task: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setMessage("");
    try { if (!fixture || !isLocalTestWallet(window.location)) throw Error("Public Reclaim financial execution is disabled."); await task(); }
    catch (error) { if (testWalletErrorCode(error) !== 4001) setReview(null); setMessage(testWalletErrorCode(error) === 4001 ? "Wallet request rejected. No transaction was submitted by this page." : error instanceof Error ? error.message : "Verified Reclaim evidence is unavailable."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function load(address: string) {
    if (!reclaimAddress(address)) { setMessage("Enter the complete campaign address."); return; }
    active.current?.abort(); const abort = new AbortController(); active.current = abort;
    const version = ++generation.current; setBusy(true); setMessage("");
    if (!sameReclaimHex(selectedCampaign, address)) { setSnapshot(null); setStale(false); }
    setSelectedCampaign(address); selected.current = address; invalidate();
    try {
      const url = new URL(reclaimReadPath, window.location.origin); url.searchParams.set("campaign", address);
      const response = await fetch(url.pathname + url.search, { cache: "no-store", redirect: "error", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]) });
      const payload = await bounded(response);
      if (!response.ok || !fixture || !isReclaimSnapshot(payload) || !sameReclaimHex(payload.campaign, address)) throw Error("Reclaim evidence unavailable.");
      if (generation.current !== version) return;
      setSnapshot(payload); setStale(false); setCollection(current => payload.collections.some(item => sameReclaimHex(item.address, current)) ? current : payload.collections[0]?.address || "");
    } catch { if (generation.current === version) { setStale(true); setMessage("Verified campaign evidence is unavailable. A failed read does not prove a zero reserve, missing campaign or eligible NFT."); } }
    finally { if (generation.current === version) setBusy(false); }
  }
  function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready) return;
    const value = new FormData(event.currentTarget).get("campaignAddress");
    if (typeof value !== "string" || !reclaimAddress(value.trim())) { setMessage("Enter the complete campaign address."); return; }
    setCampaignInput(value.trim()); void load(value.trim());
  }
  async function connect() {
    await run(async () => { const current = await connectTestWallet(); revision.current++; setWallet(current); setReview(null); setMessage("Test wallet connected on isolated chain 31337. Connection grants no campaign authority."); });
  }
  function expiry() {
    if (!snapshot) throw Error("Load verified campaign evidence first.");
    return Math.floor(Date.parse(snapshot.observed.timestamp) / 1000 + 3 * 86400).toString();
  }
  async function prepare(operation: ReclaimOperation, fields: ReclaimFields) {
    await run(async () => {
      if (!wallet) throw Error("Connect the fresh test wallet first.");
      await assertTestWalletBinding(wallet);
      if (!reclaimAddress(actor)) throw Error("Choose a valid acting wallet or Safe address.");
      const fieldDigest = reclaimFieldsDigest(operation, fields);
      const version = ++revision.current; setReview(null);
      const payload = await post({ action: "prepare", operation, account: actor, ...(operation !== "create-campaign" && { campaign: selectedCampaign }), fields });
      if (!isReclaimReview(payload) || payload.operation !== operation || !sameReclaimHex(payload.actor, actor)
        || operation !== "create-campaign" && !sameReclaimHex(payload.campaign, selectedCampaign) || reclaimFieldsDigest(operation, payload.fields) !== fieldDigest) throw Error("Unsigned Reclaim terms could not be bound to this form.");
      if (revision.current !== version) throw Error("The form or wallet changed. Review current terms again.");
      setReview(payload);
    });
  }
  async function confirm() {
    const original = review, bound = wallet, form = revision.current;
    if (!original || original.status !== "prepared" || !original.request || !bound) return;
    await run(async () => {
      if (!navigator.locks?.request) throw Error("This browser cannot coordinate wallet submissions safely.");
      await navigator.locks.request(`rmt.claim.execution.v1:31337:${original.actor.toLowerCase()}`, { mode: "exclusive", ifAvailable: true }, async acquired => {
        if (!acquired) throw Error("Another transaction is using this wallet. Preserve its recovery record.");
        if (!sameReclaimHex(bound.account, original.actor) || Date.now() / 1000 >= original.expiresAt || revision.current !== form) throw Error("The account, review or deadline changed. Review current terms.");
        assertNoUnresolvedFinancialRequests(original.actor);
        assertNoPendingLifecycleForReclaim(localStorage, original.actor);
        const creation = readActiveTestCreation(localStorage);
        if (creation && sameReclaimHex(creation.request.from, original.actor)) throw Error("Recover or explicitly archive the earlier token creation before submitting Reclaim.");
        await assertTestWalletBinding(bound, { blockNumber: "0x" + BigInt(original.observed.blockNumber).toString(16), blockHash: original.observed.blockHash });
        const [code, delegate, nonce, targetCode] = await Promise.all([
          bound.request.call(bound.provider, { method: "eth_getCode", params: [original.actor, "latest"] }),
          original.kind === "metamask-7702" ? bound.request.call(bound.provider, { method: "eth_getCode", params: [claimDelegatePin.address, "latest"] }) : undefined,
          bound.request.call(bound.provider, { method: "eth_getTransactionCount", params: [original.actor, "pending"] }),
          bound.request.call(bound.provider, { method: "eth_getCode", params: [original.innerCall.to, "latest"] }),
        ]);
        if (typeof code !== "string" || keccak256(code as `0x${string}`) !== original.actorCodeHash
          || original.kind === "eoa" && code !== "0x" || original.kind === "metamask-7702" && !sameReclaimHex(code, claimDelegatePin.designator)
          || original.kind === "metamask-7702" && (typeof delegate !== "string" || keccak256(delegate as `0x${string}`) !== claimDelegatePin.runtimeHash)
          || typeof targetCode !== "string" || keccak256(targetCode as `0x${string}`) !== original.targetRuntimeHash
          || typeof nonce !== "string" || !/^0x[0-9a-f]+$/i.test(nonce) || BigInt(nonce) !== BigInt(original.request!.nonce)) throw Error("The actor runtime or pending nonce no longer matches the review.");
        const fresh = await post({ action: "revalidate", review: original }) as Record<string, unknown>;
        if (fresh.status !== "unchanged" || fresh.reviewHash !== original.reviewHash || fresh.executionEnabled !== false || revision.current !== form) throw Error("The reviewed nonce, policy, eligibility or transaction changed. Review again.");
        await assertTestWalletBinding(bound, { blockNumber: "0x" + BigInt(original.observed.blockNumber).toString(16), blockHash: original.observed.blockHash });
        assertNoUnresolvedFinancialRequests(original.actor);
        assertNoPendingLifecycleForReclaim(localStorage, original.actor);
        const now = Date.now(); const old = listReclaimJournals(localStorage).find(item => item.review.reviewHash === original.reviewHash);
        let entry: ReclaimJournal = { schemaVersion: 1, review: original, stage: "awaiting-wallet", transactionHash: null, result: null, createdAt: old?.createdAt ?? now, updatedAt: now };
        storeReclaimJournal(localStorage, entry); refreshJournals();
        try {
          const hash = await bound.request.call(bound.provider, { method: "eth_sendTransaction", params: [original.request] });
          entry = { ...entry, stage: isTransactionHash(hash) ? "pending" : "hash-missing", transactionHash: isTransactionHash(hash) ? hash : null, updatedAt: Date.now() };
          storeReclaimJournal(localStorage, entry); refreshJournals(); setReview(null);
          setMessage(entry.transactionHash ? "Transaction submitted. Verify its canonical receipt and indexed settlement." : "The wallet returned no transaction hash. Recover the original request; do not submit it again.");
        } catch (error) {
          entry = { ...entry, stage: testWalletErrorCode(error) === 4001 ? "wallet-rejected" : "hash-missing", updatedAt: Date.now() };
          storeReclaimJournal(localStorage, entry); refreshJournals(); if (entry.stage !== "wallet-rejected") setReview(null); throw error;
        }
      });
    });
  }
  async function recover() {
    const original = journals.find(item => item.review.reviewHash === journalKey);
    if (!original) return;
    await run(async () => {
      const hash = manualHash.trim() || original.transactionHash;
      if (hash && !reclaimHash(hash)) throw Error("Enter the complete original transaction hash.");
      if (original.transactionHash && hash && !sameReclaimHex(original.transactionHash, hash)) throw Error("The original transaction hash cannot be replaced.");
      const payload = await post({ action: "verify", review: original.review, ...(hash && { transactionHash: hash }) });
      if (!reclaimVerificationMatches(original.review, payload, hash ?? undefined)) throw Error("Recovery evidence does not match the original reviewed transaction.");
      const entry: ReclaimJournal = { ...original, transactionHash: payload.transactionHash ?? original.transactionHash, stage: payload.status, result: payload, updatedAt: Date.now() };
      storeReclaimJournal(localStorage, entry); refreshJournals();
      if (payload.snapshot && selected.current && sameReclaimHex(selected.current, payload.snapshot.campaign)) { setSnapshot(payload.snapshot); setStale(false); }
      if (original.review.operation === "create-campaign" && payload.status === "confirmed") {
        setCampaignInput(original.review.campaign); setSelectedCampaign(original.review.campaign); selected.current = original.review.campaign;
        if (payload.snapshot) setSnapshot(payload.snapshot);
      }
      setMessage(verificationLabel(payload));
    });
  }
  function change(setter: (value: string) => void) { return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setter(event.target.value); invalidate(); }; }
  const collectionData = snapshot?.collections.find(item => sameReclaimHex(item.address, collection));
  const localDisabled = !fixture || !ready || busy;
  const selectedJournal = journals.find(entry => entry.review.reviewHash === journalKey);
  return <>
    <header className="lpPageHeading"><div><h1>RMT Reclaim</h1><p>Eligible NFT trade-ins. Separate funding, explicit custody and exact rewards.</p></div></header>
    <MyLaunchesNav active="reclaim" />
    <p className="lpInlineNotice">{fixture ? "Isolated chain 31337 · synthetic NFTs and tokens only. No production financial execution." : "Read-only · No verified live campaign, new RMT token, price reference or funded reward reserve. Claims are disabled."}</p>
    <section className="lpPanel lpForm lpReclaimIntro" aria-label="Reclaim custody and funding">
      <h2>Escrow, not burn</h2><p>Accepted ERC-721 and ERC-1155 NFTs remain in their campaign&apos;s escrow. Only the original claimant can return the exact original reward and receive their NFTs back. Accepted eligibility and caps stay consumed. There is no owner NFT withdrawal, sink transfer or burn.</p>
      <p>Rewards require manually deposited tokens. No project fees, treasury funds, Operations, Reserve or royalties are drawn automatically.</p>
      <details><summary>Proposed reward budget</summary><p>The $20 budget and $0.05 per eligible NFT are nominal goals, not a live price or promise. The local model assumes 1 synthetic RMT = $0.01 and uses fixed 5-token rewards from 2,000 synthetic tokens. Production requires its own approved token-unit schedule or a defensible price reference and funded reserve.</p></details>
    </section>
    <form className="lpPanel lpForm lpEarningsLookup" aria-label="Find Reclaim campaign" data-reclaim-ready={ready ? "true" : "false"} onSubmit={lookup}>
      <label htmlFor="reclaim-campaign">Campaign address<input id="reclaim-campaign" name="campaignAddress" value={campaignInput} disabled={!ready || busy} maxLength={42} onChange={change(setCampaignInput)} placeholder="0x…" spellCheck={false} autoComplete="off" /></label>
      <button className="lpButton" disabled={!ready || busy} type="submit">{busy ? "Checking evidence…" : "View campaign"}</button>
      <small>A lookup is not proof of eligibility, ownership, funding or wallet authority.</small>
    </form>
    {message && <p className="lpInlineNotice" role="status">{message}</p>}
    {stale && <p className="lpInlineNotice" role="alert">Evidence unavailable or stale. Previous observations cannot authorize a new trade-in.</p>}
    {snapshot ? <section className="lpPanel lpForm lpReclaimCampaign" aria-label="Verified Reclaim campaign">
      <div className="lpTreasuryHeading"><h2>Verified campaign</h2><strong>{snapshot.closed ? "Closed" : snapshot.paused ? "Paused"
        : BigInt(snapshot.reserve.availableWei) < BigInt(snapshot.rewardPerUnit) ? "Awaiting funded reserve"
          : !snapshot.collections.some(item => item.admission === "admitted" && item.enabled) ? "Awaiting collection admission" : "Accepting eligible trade-ins"}</strong></div>
      <dl className="lpFacts"><dt>Campaign</dt><dd>{snapshot.campaign}</dd><dt>Controller</dt><dd>{snapshot.controller} · epoch {snapshot.controllerEpoch}</dd>
        <dt>Fixed reward</dt><dd>{amount(snapshot.rewardPerUnit)} {snapshot.rewardSymbol} per eligible unit · no live USD valuation</dd><dt>Policy epoch</dt><dd>{snapshot.policyEpoch}</dd>
        <dt>Held reserve</dt><dd>{amount(snapshot.reserve.heldWei)} {snapshot.rewardSymbol}</dd><dt>Available reserve</dt><dd>{amount(snapshot.reserve.availableWei)} {snapshot.rewardSymbol}</dd>
        <dt>Paid / repaid</dt><dd>{amount(snapshot.reserve.paidWei)} / {amount(snapshot.reserve.repaidWei)} {snapshot.rewardSymbol}</dd><dt>Unpaid liability</dt><dd>{amount(snapshot.reserve.liabilityWei)} · atomic funded rewards only</dd>
        <dt>Indexed evidence</dt><dd>{snapshot.history.indexed ? "Indexed and verified" : "On-chain evidence observed; indexing pending"}</dd></dl>
      <p className="lpEarningsCheckpoint">Observed synthetic block {snapshot.observed.blockNumber} · {when(snapshot.observed.timestamp)}. This is not production L1 finality.</p>
      <button className="lpButton lpButtonSecondary" type="button" disabled={busy} onClick={() => void load(snapshot.campaign)}>Refresh campaign evidence</button>
      <h3>Accepted collections</h3><ul className="lpTreasuryHistory">{snapshot.collections.length ? snapshot.collections.map(item => <li key={item.address}>
        <strong>ERC-{item.standard === 1 ? "721" : "1155"} · {item.admission === "candidate" ? "Not admitted" : item.enabled ? "Admitted" : "Disabled"}</strong><span>{item.address}</span>
        <span>Collection cap {item.collectionCap}; wallet cap {item.walletCap}; accepted units {item.acceptedUnits}.</span>
        {item.admission === "admitted" && item.enabled && <span>Eligible IDs: {item.eligibleItems.length ? item.eligibleItems.map(nft => `${nft.tokenId} (up to ${nft.remainingQuantity} remaining)`).join(" · ") : "No verified eligible inventory."}</span>}
      </li>) : <li>No collection has been admitted. Metadata or ownership alone does not establish eligibility.</li>}</ul>
      {snapshot.pending.length > 0 && <details><summary>Pending owner notices</summary><ul className="lpTreasuryHistory">{snapshot.pending.map(item => <li key={item.kind}><strong>{label(item.kind)}</strong><span>{item.detail}</span><span>Ready {when(item.readyAt)} · expires {when(item.expiresAt)} · epoch {item.epoch}</span></li>)}</ul></details>}
    </section> : <section className="lpPanel lpForm" aria-label="Reclaim availability"><h2>No verified campaign selected</h2><p>Rewards and NFT eligibility are unavailable until a real campaign, token, deposited reserve and admission policy are verified. No balances or accepted NFTs are assumed.</p></section>}
    {fixture && <section className="lpPanel lpForm lpReclaimWallet" aria-label="Local Reclaim wallet controls">
      <h2>Test wallet</h2><button className="lpButton lpButtonSecondary" type="button" disabled={localDisabled} onClick={() => void connect()}>{wallet ? "Reconnect test wallet" : "Connect test wallet"}</button>
      {wallet && <p>Selected wallet: <span className="lpReclaimAddress">{wallet.account}</span> · chain 31337</p>}
      <details><summary>Act through an existing Safe</summary><label htmlFor="reclaim-safe">Safe acting address (optional)<input id="reclaim-safe" value={safeActor} disabled={localDisabled} onChange={change(setSafeActor)} placeholder="0x…" /></label><small>This prepares an unsigned inner CALL only. Safe owners must use the Safe&apos;s own approval workflow; their EOA cannot transfer Safe-owned NFTs directly.</small></details>
      <h3>Review an NFT trade-in</h3>
      <label htmlFor="reclaim-collection">Collection<select id="reclaim-collection" aria-label="Collection" value={collection} disabled={localDisabled || !snapshot} onChange={change(setCollection)}><option value="">Choose a verified collection</option>{snapshot?.collections.map(item => <option key={item.address} value={item.address}>ERC-{item.standard === 1 ? "721" : "1155"} · {item.address} · {item.admission}</option>)}</select></label>
      <div className="lpReclaimGrid"><label htmlFor="reclaim-token-ids">Exact token IDs<input id="reclaim-token-ids" value={tokenIds} disabled={localDisabled} onChange={change(setTokenIds)} placeholder="1, 2" inputMode="text" /></label><label htmlFor="reclaim-quantities">Quantities in matching order<input id="reclaim-quantities" value={quantities} disabled={localDisabled} onChange={change(setQuantities)} placeholder="1, 1" inputMode="text" /></label></div>
      <small>At most eight strictly increasing IDs and twenty units. ERC-721 quantities must be one. Approval is separate from surrender.</small>
      <div className="lpReclaimActions"><button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !collectionData} onClick={() => void prepare(collectionData?.standard === 1 ? "approve-721" : "approve-1155", collectionData?.standard === 1 ? { collection, tokenId: entries(tokenIds)[0] } : { collection })}>Review NFT approval</button>
        <button className="lpButton" disabled={localDisabled || !wallet || !snapshot || stale || snapshot.paused || snapshot.closed || !collectionData?.enabled || collectionData.admission !== "admitted"} onClick={() => void prepare("redeem", { collection, tokenIds: entries(tokenIds), quantities: entries(quantities) })}>Review NFT trade-in</button></div>
      {collectionData?.standard === 2 && <p className="lpInlineNotice">ERC-1155 approval covers this collection for the exact campaign operator. It is not a one-token allowance. Review the immutable campaign and operator address before confirming.</p>}
      {collectionData?.standard === 2 && <button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet} onClick={() => void prepare("revoke-1155", { collection })}>Review ERC-1155 approval revocation</button>}
      <details className="lpReclaimOwner"><summary>Campaign owner dashboard</summary><p>Funding is manual. Ownership, notices and available reserves are rechecked before every transaction. Rates affect only later successful redemptions; a stale submitted rate reverts atomically.</p>
        <h3>Create an isolated campaign</h3><label htmlFor="reclaim-controller">Controller address<input id="reclaim-controller" value={controller} disabled={localDisabled} onChange={change(setController)} placeholder={wallet?.account ?? "0x…"} /></label>
        <div className="lpReclaimGrid"><label htmlFor="reclaim-reward">Fixed reward per NFT (synthetic RMT)<input id="reclaim-reward" value={rewardUnits} disabled={localDisabled} onChange={change(setRewardUnits)} inputMode="decimal" /></label><label htmlFor="reclaim-wallet-cap">Campaign units per wallet<input id="reclaim-wallet-cap" value={walletCap} disabled={localDisabled} onChange={change(setWalletCap)} inputMode="numeric" /></label></div>
        <button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet} onClick={() => { try { if (!wallet) throw Error("Connect a test wallet."); void prepare("create-campaign", { intentId: intentFor(actor), controller: controller || actor, rewardPerUnit: tokens(rewardUnits), walletCap }); } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid campaign terms."); } }}>Review campaign creation</button>
        <h3>Manual funding and reserve</h3><label htmlFor="reclaim-funding">Amount (synthetic RMT)<input id="reclaim-funding" value={fundUnits} disabled={localDisabled} onChange={change(setFundUnits)} inputMode="decimal" /></label><div className="lpReclaimActions">
          <button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !snapshot} onClick={() => { try { void prepare("approve-funding", { amountWei: tokens(fundUnits) }); } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid amount."); } }}>Review exact funding approval</button>
          <button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !snapshot} onClick={() => { try { void prepare("fund", { amountWei: tokens(fundUnits) }); } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid amount."); } }}>Review manual funding</button></div>
        <h3>Collection admission</h3><div className="lpReclaimGrid"><label htmlFor="reclaim-collection-cap">Collection unit cap<input id="reclaim-collection-cap" value={collectionCap} disabled={localDisabled} onChange={change(setCollectionCap)} inputMode="numeric" /></label><label htmlFor="reclaim-collection-wallet-cap">Collection units per wallet<input id="reclaim-collection-wallet-cap" value={collectionWalletCap} disabled={localDisabled} onChange={change(setCollectionWalletCap)} inputMode="numeric" /></label></div>
        <div className="lpReclaimActions">{(["propose-collection", "execute-collection", "cancel-collection", "disable-collection"] as const).map(operation => <button key={operation} className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !snapshot || !collection} onClick={() => { try { void prepare(operation, operation === "propose-collection" ? { collection, collectionCap, collectionWalletCap, expiresAt: expiry() } : operation === "disable-collection" ? { collection } : {}); } catch (error) { setMessage(error instanceof Error ? error.message : "Notice unavailable."); } }}>{operation === "propose-collection" ? "Review collection notice" : operation === "execute-collection" ? "Review collection admission" : label(operation)}</button>)}</div>
        <h3>Availability and future rates</h3><div className="lpReclaimActions">{(["pause", "resume", "execute-rate", "cancel-rate", "propose-close", "execute-close", "cancel-close", "execute-recovery", "cancel-recovery"] as const).map(operation => <button key={operation} className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !snapshot} onClick={() => { try { void prepare(operation, operation === "propose-close" ? { expiresAt: expiry() } : {}); } catch (error) { setMessage(error instanceof Error ? error.message : "Notice unavailable."); } }}>{label(operation)}</button>)}</div>
        <div className="lpReclaimActions"><button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !snapshot} onClick={() => { try { void prepare("propose-rate", { rewardPerUnit: tokens(rewardUnits), expiresAt: expiry() }); } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid rate."); } }}>Review future reward notice</button>
          <button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !snapshot || !snapshot.closed} onClick={() => { try { void prepare("propose-recovery", { amountWei: tokens(fundUnits), expiresAt: expiry() }); } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid recovery amount."); } }}>Review uncommitted reserve recovery</button></div>
        <h3>Controller continuity</h3><label htmlFor="reclaim-next-controller">Incoming controller<input id="reclaim-next-controller" value={nextController} disabled={localDisabled} onChange={change(setNextController)} placeholder="0x…" /></label>
        <div className="lpReclaimActions">{(["propose-controller", "accept-controller", "cancel-controller"] as const).map(operation => <button key={operation} className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !snapshot} onClick={() => { try { void prepare(operation, operation === "propose-controller" ? { next: nextController, expiresAt: expiry() } : {}); } catch (error) { setMessage(error instanceof Error ? error.message : "Controller notice unavailable."); } }}>{label(operation)}</button>)}</div>
      </details>
      {snapshot && <details><summary>Escrow receipts and returns</summary><p>A return requires the original claimant, exact original reward repayment and NFT receiver compatibility. Eligibility and caps are never reset.</p><ul className="lpTreasuryHistory">{snapshot.receipts.length ? snapshot.receipts.map(receipt => <li key={receipt.id}><strong>Receipt {receipt.id} · {receipt.returned ? "Returned" : "NFTs held in escrow"}</strong><span>{receipt.collection} · IDs {receipt.tokenIds.join(", ")} · quantities {receipt.quantities.join(", ")}</span><span>Claimant {receipt.claimant} · original reward {amount(receipt.rewardWei)} {snapshot.rewardSymbol}</span>
        <div className="lpReclaimActions"><button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || receipt.returned} onClick={() => void prepare("approve-return", { receiptId: receipt.id })}>Review reward repayment approval</button><button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || receipt.returned} onClick={() => void prepare("return", { receiptId: receipt.id })}>Review NFT return</button></div></li>) : <li>No canonically indexed escrow receipt is available.</li>}</ul></details>}
      {review && <section className="lpRecovery lpReclaimReview" aria-label="Reviewed Reclaim transaction"><h3>{review.status === "needs-safe-approvals" ? "Safe approval required" : "Review exact test transaction"}</h3><dl className="lpFacts"><dt>Action</dt><dd>{label(review.operation)}</dd><dt>Acting wallet</dt><dd>{review.actor}</dd><dt>Campaign</dt><dd>{review.campaign}</dd><dt>Target</dt><dd>{review.innerCall.to}</dd><dt>Native value</dt><dd>0 ETH</dd><dt>Reward or repayment</dt><dd>{amount(review.rewardWei)} synthetic tokens · fixed units, no USD quote</dd>
        {review.fields.amountWei && <><dt>Exact token amount</dt><dd>{amount(review.fields.amountWei)} synthetic tokens</dd></>}
        {review.transfer && <><dt>Token transfer</dt><dd>{amount(review.transfer.amountWei)} synthetic tokens · {review.transfer.asset}</dd><dt>From</dt><dd>{review.transfer.from}</dd><dt>Recipient</dt><dd>{review.transfer.to}</dd></>}
        {review.fields.rewardPerUnit && <><dt>Fixed reward per eligible unit</dt><dd>{amount(review.fields.rewardPerUnit)} synthetic tokens</dd></>}
        {review.fields.collection && <><dt>NFT collection</dt><dd>{review.fields.collection}</dd></>}
        {(review.fields.tokenIds || review.fields.tokenId) && <><dt>Exact NFT IDs / quantities</dt><dd>{review.fields.tokenIds?.join(", ") ?? review.fields.tokenId} / {review.fields.quantities?.join(", ") ?? "1"}</dd></>}
        {review.nft && !review.fields.tokenIds && <><dt>Original receipt / NFT IDs / quantities</dt><dd>{review.nft.receiptId} / {review.nft.tokenIds.join(", ")} / {review.nft.quantities.join(", ")}</dd></>}
        {review.operation === "approve-1155" && <><dt>Approval scope</dt><dd>All NFTs in this collection for this exact campaign operator. This is not a one-token allowance.</dd></>}
        <dt>Policy / controller epoch</dt><dd>{review.policyEpoch} / {review.controllerEpoch}</dd><dt>Maximum network fee</dt><dd>{amount(review.maximumNetworkFeeWei)} synthetic ETH</dd><dt>Expiry</dt><dd>{when(String(review.expiresAt))}</dd><dt>Custody</dt><dd>Reversible escrow, not burn. Return only against the exact original reward repayment.</dd></dl>
        <ul>{review.notices.map(notice => <li key={notice}>{notice}</li>)}</ul><details><summary>Exact contract data and normalized fields</summary><pre>{JSON.stringify({ fields: review.fields, innerCall: review.innerCall, request: review.request }, null, 2)}</pre></details>
        {review.status === "prepared" ? <button className="lpButton" disabled={localDisabled || !wallet} onClick={() => void confirm()}>Confirm test Reclaim transaction</button> : <p className="lpInlineNotice">Unsigned Safe inner CALL only. No owner EOA submission or automatic Safe signature is available here.</p>}
      </section>}
      <details className="lpReclaimRecovery"><summary>Recover original Reclaim transaction</summary><p>Recovery only reads the original transaction. It never requests another signature or broadcasts a duplicate.</p>
        <label htmlFor="reclaim-original">Original Reclaim request<select id="reclaim-original" aria-label="Original Reclaim request" value={journalKey} onChange={event => { setJournalKey(event.target.value); setManualHash(""); }} disabled={localDisabled}><option value="">Choose a preserved request</option>{journals.map(entry => <option key={entry.review.reviewHash} value={entry.review.reviewHash}>{label(entry.review.operation)} · {entry.stage} · {entry.review.actor.slice(0, 10)}…</option>)}</select></label>
        {selectedJournal && <><p>{selectedJournal.transactionHash ?? "Transaction hash not returned; original actor and nonce remain preserved."}</p><p>{selectedJournal.result ? verificationLabel(selectedJournal.result) : reclaimJournalTerminal(selectedJournal) ? "This original outcome remains in history." : "Original outcome unresolved. Do not submit it again."}</p></>}
        <label htmlFor="reclaim-original-hash">Original transaction hash (if available)<input id="reclaim-original-hash" value={manualHash} onChange={event => setManualHash(event.target.value)} disabled={localDisabled} maxLength={66} placeholder="0x…" /></label>
        <button className="lpButton lpButtonSecondary" disabled={localDisabled || !selectedJournal} onClick={() => void recover()}>Verify original Reclaim transaction</button>
      </details>
    </section>}
  </>;
}
function verificationLabel(value: ReclaimVerification) {
  if (value.status === "confirmed") return value.indexed ? "Canonical transaction and indexed settlement verified." : "Confirmed on-chain; canonical indexing is pending.";
  if (value.status === "reverted") return "Transaction reverted. NFT custody and reward settlement were not accepted.";
  if (value.status === "reorged") return "Previously observed evidence was invalidated by a reorganization. Preserve the original transaction identity.";
  if (value.status === "pending") return "Original transaction or its settlement evidence remains pending. No duplicate submission was requested.";
  return "Original transaction evidence is unavailable. This is not proof of success, rejection or a missing campaign.";
}
