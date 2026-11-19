"use client";

import { useEffect, useRef, useState } from "react";
import { keccak256 } from "viem";
import { claimDelegatePin } from "../../lib/claim-profiles";
import { listClaimJournals } from "../../lib/claim-recovery";
import { earningsAmount } from "../../lib/earnings";
import { isLocalTestWallet, isTransactionHash } from "../../lib/test-creation";
import { connectTestWallet, subscribeTestWallet, testProviderAtWindow, testWalletErrorCode, type TestWallet } from "../../lib/test-wallet";
import { readActiveTestCreation } from "../../lib/test-creation-history";
import { assertNoPendingReclaim } from "../../lib/reclaim-recovery";
import { treasuryPurchaseIntentAction, treasuryPurchaseIntentLabel } from "../../lib/treasury-purchase-capability";
import { isProjectTreasuryProof, isProjectTreasuryReview, isProjectTreasurySnapshot, projectTreasuryProfile, projectTreasuryTestPath,
  treasuryHash, type ProjectTreasuryOperation, type ProjectTreasuryProof, type ProjectTreasuryReview,
  type ProjectTreasuryPreview, type ProjectTreasurySnapshot, type ProjectTreasuryVerification } from "../../lib/project-treasury";

const namespace = "rmt.project-treasury.pending.v1", indexKey = namespace + ":index";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
type Journal = { schemaVersion: 1; review: ProjectTreasuryReview; stage: "awaiting-wallet" | "wallet-rejected" | "hash-missing" | ProjectTreasuryVerification["status"];
  transactionHash: string | null; result: ProjectTreasuryVerification | null; createdAt: number; updatedAt: number };
const key = (r: ProjectTreasuryReview) => `${namespace}:${r.reviewHash}`;
const recordLimit = (r: ProjectTreasuryReview) => r.operation === "create-treasury" ? 160 * 1024 : 32768;
const bytes = (raw: string) => new TextEncoder().encode(raw).byteLength;
const terminal = (j: Journal) => j.stage === "confirmed" || j.stage === "reverted" || j.stage === "wallet-rejected";
function validJournal(value: unknown): value is Journal {
  const j = value as Journal;
  return !!j && Object.keys(j).length === 7 && j.schemaVersion === 1 && isProjectTreasuryReview(j.review) && j.review.status === "prepared"
    && ["awaiting-wallet", "wallet-rejected", "hash-missing", "pending", "confirmed", "reverted", "unavailable"].includes(j.stage)
    && (j.transactionHash === null || isTransactionHash(j.transactionHash)) && Number.isSafeInteger(j.createdAt) && j.createdAt > 0
    && Number.isSafeInteger(j.updatedAt) && j.updatedAt >= j.createdAt
    && (j.result === null ? !["confirmed", "reverted"].includes(j.stage) : j.result.status === j.stage
      && treasuryVerificationMatches(j.review, j.result, j.transactionHash ?? undefined)
      && (!["confirmed", "reverted"].includes(j.stage) || j.transactionHash !== null && same(j.transactionHash, j.result.transactionHash ?? "")));
}
function readJournals(): Journal[] {
  const raw = localStorage.getItem(indexKey); if (raw === null) return [];
  if (raw.length > 8192) throw Error("Treasury recovery index exceeds its bound. Preserve the original requests.");
  const keys: unknown = JSON.parse(raw);
  if (!Array.isArray(keys) || keys.length > 32 || new Set(keys).size !== keys.length || keys.some(k => typeof k !== "string" || !/^rmt\.project-treasury\.pending\.v1:0x[0-9a-f]{64}$/i.test(k))) throw Error("Treasury recovery index is invalid.");
  return keys.map(k => {
    const raw = localStorage.getItem(k); if (!raw || raw.length > 160 * 1024 || bytes(raw) > 160 * 1024) throw Error("A treasury recovery record is unavailable.");
    const value: unknown = JSON.parse(raw); if (!validJournal(value) || key(value.review) !== k || bytes(raw) > recordLimit(value.review)) throw Error("A treasury recovery identity is invalid."); return value;
  }).sort((a, b) => b.createdAt - a.createdAt);
}
/** A new creator request must not strand another controller's uncertain wallet
 * outcome. Canonically observed completed receipts remain recoverable history. */
export function assertNoUnresolvedFinancialRequests(account: string) {
  assertNoPendingReclaim(localStorage, account);
  if (readJournals().some(j => same(j.review.actor, account) && !terminal(j))) throw Error("Recover the earlier treasury transaction before creating a token.");
  if (listClaimJournals(localStorage).some(j => same(j.review.gasPayer, account)
    && !["canonical-l2", "settled", "reverted", "wallet-rejected"].includes(j.stage))) throw Error("Recover the earlier profiled claim before creating a token.");
}
function store(j: Journal) {
  if (!validJournal(j)) throw Error("Invalid treasury recovery record");
  const all = readJournals(), old = all.find(entry => key(entry.review) === key(j.review));
  if (old && (old.review.reviewHash !== j.review.reviewHash || old.createdAt !== j.createdAt || old.transactionHash && old.transactionHash !== j.transactionHash)) throw Error("The original treasury request cannot be replaced.");
  if (!old && all.length >= 32) throw Error("The treasury recovery journal is full. Existing requests will not be evicted.");
  const serialized = JSON.stringify(j); if (bytes(serialized) > recordLimit(j.review)) throw Error("Treasury recovery record exceeds its bound.");
  localStorage.setItem(key(j.review), serialized);
  localStorage.setItem(indexKey, JSON.stringify(old ? all.map(entry => key(entry.review)) : [...all.map(entry => key(entry.review)), key(j.review)]));
  if (localStorage.getItem(key(j.review)) !== serialized || !readJournals().some(entry => entry.review.reviewHash === j.review.reviewHash)) throw Error("Treasury request could not be saved before wallet confirmation.");
}
export function treasuryVerificationMatches(review: ProjectTreasuryReview, result: unknown, knownHash?: string): result is ProjectTreasuryVerification {
  try {
    const r = result as ProjectTreasuryVerification;
    if (!r || r.schemaVersion !== 1 || r.profile !== projectTreasuryProfile || r.chainId !== 31337 || r.executionEnabled !== false
      || r.finality !== "synthetic-local-not-production" || r.reviewHash !== review.reviewHash || !["pending", "confirmed", "reverted", "unavailable"].includes(r.status)
      || r.indexed !== undefined && typeof r.indexed !== "boolean"
      || r.transactionHash !== undefined && (!isTransactionHash(r.transactionHash) || !!knownHash && !same(knownHash, r.transactionHash))) return false;
    if (["confirmed", "reverted"].includes(r.status) && (!r.transactionHash || !r.canonical || !treasuryHash(r.canonical.blockHash)
      || !/^[1-9][0-9]{0,15}$/.test(r.canonical.blockNumber) || BigInt(r.canonical.blockNumber) <= BigInt(review.observed.blockNumber)
      || !Number.isFinite(Date.parse(r.canonical.timestamp)))) return false;
    if (r.proof && (!isProjectTreasuryProof(r.proof) || !same(r.proof.treasury, review.treasury) || !same(r.proof.creator, review.creator)
      || !same(r.proof.intentId, review.intentId) || !same(r.proof.treasuryFactory, review.treasuryFactory) || !same(r.proof.coreFactory, review.coreFactory))) return false;
    if (r.status === "confirmed" && review.operation === "create-treasury" && (!r.proof || !same(r.proof.controller, review.controller)
      || r.proof.treasuryShareBps !== review.args.treasuryShareBps || !same(r.proof.factoryRuntimeHash, review.targetRuntimeHash)
      || !same(r.proof.deployment.transactionHash, r.transactionHash!) || r.proof.deployment.blockNumber !== r.canonical?.blockNumber
      || !same(r.proof.deployment.blockHash, r.canonical?.blockHash ?? "") || r.proof.deployment.timestamp !== r.canonical?.timestamp)) return false;
    return !r.snapshot || isProjectTreasurySnapshot(r.snapshot) && same(r.snapshot.treasury, review.treasury)
      && same(r.snapshot.proof.intentId, review.intentId) && same(r.snapshot.proof.creator, review.creator)
      && same(r.snapshot.proof.treasuryFactory, review.treasuryFactory) && same(r.snapshot.proof.coreFactory, review.coreFactory)
      && (review.operation === "create-treasury" ? same(r.snapshot.proof.deployment.transactionHash, r.transactionHash ?? "")
        : same(r.snapshot.proof.runtimeHash, review.targetRuntimeHash));
  } catch { return false; }
}
export async function postProjectTreasury(body: object) {
  if (!isLocalTestWallet(window.location)) throw Error("Treasury execution is available only in the isolated local test build.");
  const response = await fetch(projectTreasuryTestPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw Error(response.status === 429 ? "Treasury evidence reads are limited. Keep the original request." : "Treasury evidence is unavailable.");
  return response.json() as Promise<Record<string, unknown>>;
}

export function useTreasuryExecution({ fixture, treasury, expected, onVerified, onChanged }: { fixture: boolean; treasury?: string;
  expected?: { proof: ProjectTreasuryProof; controller: string; controllerKind: ProjectTreasurySnapshot["controllerKind"] };
  onVerified?(proof: ProjectTreasuryProof): void; onChanged?(): void }) {
  const [wallet, setWallet] = useState<TestWallet | null>(null), [review, setReview] = useState<ProjectTreasuryReview | null>(null);
  const [journals, setJournals] = useState<Journal[]>([]), [selected, setSelected] = useState(""), [enteredHash, setEnteredHash] = useState("");
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const locked = useRef(false), revision = useRef(0);
  const reload = () => setJournals(readJournals().filter(j => !treasury || same(j.review.treasury, treasury)));
  useEffect(() => { try { reload(); } catch (e) { setMessage(e instanceof Error ? e.message : "Recovery unavailable"); } }, [treasury]);
  useEffect(() => () => { revision.current++; }, []);
  useEffect(() => {
    if (!wallet) return;
    return subscribeTestWallet(wallet, () => { revision.current++; setWallet(null); setReview(null); setMessage("Wallet account or chain changed. Original submitted treasury requests remain recoverable."); });
  }, [wallet]);
  const invalidate = () => { revision.current++; setReview(null); setMessage(""); };
  async function run(task: () => Promise<void>) {
    if (locked.current) return; locked.current = true; setBusy(true); setMessage("");
    try { if (!fixture || !isLocalTestWallet(window.location)) throw Error("Public financial execution is disabled."); await task(); }
    catch (e) { if (testWalletErrorCode(e) !== 4001) setReview(null); setMessage(testWalletErrorCode(e) === 4001
      ? "Wallet request rejected. The exact request is retained for an explicit retry; nothing is resent automatically."
      : e instanceof Error ? e.message : "Treasury evidence unavailable."); try { reload(); } catch { /* Never resubmit after storage failure. */ } }
    finally { locked.current = false; setBusy(false); }
  }
  const connect = () => run(async () => { setWallet(await connectTestWallet()); });
  async function prepare(operation: ProjectTreasuryOperation, args: Record<string, string | number | boolean> = {}, creation?: ProjectTreasuryPreview) {
    if (!wallet) throw Error("Connect a synthetic controller or creator wallet first.");
    // A Safe inner CALL identifies its actual required caller. The connected
    // EOA is never represented as the Safe and no request can be submitted.
    const controllerOnly = ["claim-curve", "collect-lp", "claim-lp", "claim-lp-native", "claim-lp-token", "set-purchases", "schedule-controller", "cancel-controller", "schedule-withdrawal"].includes(operation);
    const requiredCaller = expected?.controllerKind === "safe-1.4.1" && controllerOnly ? expected.controller : wallet.account;
    const at = revision.current, result = await postProjectTreasury({ action: "prepare", account: requiredCaller, operation,
      ...(creation ? { controller: creation.controller, intentId: creation.intentId, treasuryShareBps: creation.treasuryShareBps } : { treasury, args }) });
    const unchangedArg = (a: unknown, b: unknown) => a === b || typeof a === "string" && typeof b === "string"
      && (a.startsWith("0x") && b.startsWith("0x") && same(a, b)
        || /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(a) && /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(b) && BigInt(a) === BigInt(b));
    const valid = at === revision.current && isProjectTreasuryReview(result) && result.operation === operation
      && (!treasury || same(result.treasury, treasury)) && same(result.actor, requiredCaller)
      && (!creation || same(result.controller, creation.controller) && same(result.intentId, creation.intentId) && same(result.creator, creation.creator)
        && same(result.treasury, creation.treasury) && same(result.treasuryFactory, creation.treasuryFactory) && same(result.coreFactory, creation.coreFactory)
        && result.args.treasuryShareBps === creation.treasuryShareBps)
      && (!expected || same(result.creator, expected.proof.creator) && same(result.intentId, expected.proof.intentId) && same(result.controller, expected.controller)
        && same(result.treasuryFactory, expected.proof.treasuryFactory) && same(result.coreFactory, expected.proof.coreFactory))
      && Object.entries(args).every(([key, value]) => unchangedArg(value, result.args[key]))
      && (result.kind === "safe-inner" ? expected?.controllerKind === "safe-1.4.1" && result.request === null : same(result.actor, wallet.account));
    if (!valid) throw Error("Treasury review differs from the chosen account, action or project.");
    setReview(result);
  }
  async function recover(entry: Journal, hash = enteredHash.trim() || entry.transactionHash || undefined) {
    if (hash && !isTransactionHash(hash)) throw Error("Enter the complete original transaction hash.");
    const result = await postProjectTreasury({ action: "verify", review: entry.review, ...(hash && { transactionHash: hash }) });
    if (!treasuryVerificationMatches(entry.review, result, entry.transactionHash ?? undefined)) throw Error("Recovery does not match the original treasury transaction.");
    const next: Journal = { ...entry, stage: result.status, result, updatedAt: Math.max(Date.now(), entry.updatedAt),
      transactionHash: entry.transactionHash ?? (["confirmed", "reverted"].includes(result.status) ? result.transactionHash ?? null : null) };
    store(next); reload(); setSelected(next.review.reviewHash);
    setMessage(result.status === "confirmed" ? result.indexed ? "Treasury transaction confirmed on the synthetic chain and indexed." : "Treasury transaction confirmed onchain; indexing remains pending."
      : result.status === "reverted" ? "The original transaction reverted. No treasury action completed." : result.status === "pending"
      ? "The original transaction or exact settlement is pending. It will not be sent again." : "Treasury receipt evidence is unavailable or invalidated. Preserve the original request.");
    if (result.status === "confirmed") { if (result.proof) onVerified?.(result.proof); onChanged?.(); }
  }
  async function confirm() {
    if (!wallet || !review || review.status !== "prepared" || !review.request || review.kind === "safe-inner") throw Error("A complete direct-wallet synthetic review is required.");
    const original = review, version = revision.current, provider = wallet;
    if (!navigator.locks?.request) throw Error("This browser cannot coordinate wallet requests safely.");
    await navigator.locks.request(`rmt.claim.execution.v1:31337:${original.actor.toLowerCase()}`, { mode: "exclusive", ifAvailable: true }, async acquired => {
      if (!acquired) throw Error("Another tab is handling this wallet. Recover its original transaction.");
      const check = () => { if (revision.current !== version || testProviderAtWindow() !== provider.provider || provider.provider.request !== provider.request) throw Error("The wallet or selected treasury terms changed."); };
      const walletRead = async () => {
        check(); const q = original.request!;
        const [accounts, chain, nonce, code, target, anchor, delegate] = await Promise.all([
          provider.request.call(provider.provider, { method: "eth_accounts" }), provider.request.call(provider.provider, { method: "eth_chainId" }),
          provider.request.call(provider.provider, { method: "eth_getTransactionCount", params: [original.actor, "pending"] }),
          provider.request.call(provider.provider, { method: "eth_getCode", params: [original.actor, "latest"] }),
          provider.request.call(provider.provider, { method: "eth_getCode", params: [q.to, "latest"] }),
          provider.request.call(provider.provider, { method: "eth_getBlockByNumber", params: ["0x" + BigInt(original.observed.blockNumber).toString(16), false] }),
          original.kind === "metamask-7702" ? provider.request.call(provider.provider, { method: "eth_getCode", params: [claimDelegatePin.address, "latest"] }) : undefined,
        ]); check();
        const hash = (raw: unknown) => typeof raw === "string" && /^0x(?:[0-9a-f]{2}){0,24576}$/i.test(raw) ? keccak256(raw as `0x${string}`) : null;
        if (!Array.isArray(accounts) || !same(String(accounts[0]), original.actor) || chain !== "0x7a69" || typeof nonce !== "string" || BigInt(nonce) !== BigInt(q.nonce)
          || hash(code) !== original.actorCodeHash || hash(target) !== original.targetRuntimeHash
          || original.kind === "metamask-7702" && (!same(String(code), claimDelegatePin.designator) || hash(delegate) !== claimDelegatePin.runtimeHash)
          || original.kind === "eoa" && code !== "0x"
          || !anchor || typeof anchor !== "object" || !("hash" in anchor) || !same(String(anchor.hash), original.observed.blockHash)
          || !("number" in anchor) || BigInt(String(anchor.number)) !== BigInt(original.observed.blockNumber)) throw Error("Wallet account, chain, nonce, runtime or checkpoint changed.");
      };
      const available = () => {
        assertNoPendingReclaim(localStorage, original.actor);
        const all = readJournals(), old = all.find(j => j.review.reviewHash === original.reviewHash);
        if (old && !(old.stage === "wallet-rejected" && old.transactionHash === null)) throw Error("Recover the original treasury transaction; do not submit it again.");
        if (all.some(j => !terminal(j) && j.review.reviewHash !== original.reviewHash && same(j.review.actor, original.actor)
          && j.review.request?.nonce === original.request!.nonce)) throw Error("Another treasury request reserves this wallet nonce.");
        if (listClaimJournals(localStorage).some(j => !["settled", "reverted", "wallet-rejected"].includes(j.stage)
          && same(j.review.gasPayer, original.actor) && BigInt(j.review.gasPayerEvidence.nonce) === BigInt(original.request!.nonce))) throw Error("Recover the earlier profiled claim before continuing.");
        // The existing core journal deliberately has no EVM nonce. Its active
        // slot is released only by explicit verified archival, never by parsing
        // a nonexistent nonce or inferring that an earlier call completed.
        const creation = readActiveTestCreation(localStorage);
        if (creation && same(creation.request.from, original.actor)) throw Error("Recover and archive the earlier creation transaction first.");
        return old;
      };
      available(); await walletRead();
      const fresh = await postProjectTreasury({ action: "revalidate", review: original }); check();
      if (fresh.status !== "unchanged" || fresh.reviewHash !== original.reviewHash) throw Error("Treasury preflight changed. Review fresh terms.");
      await walletRead();
      if (Date.now() >= original.expiresAt * 1000) throw Error("The treasury review expired. Recover any submitted request before reviewing again.");
      const old = available();
      const entry: Journal = { schemaVersion: 1, review: original, stage: "awaiting-wallet", transactionHash: null, result: null,
        createdAt: old?.createdAt ?? Date.now(), updatedAt: Date.now() }; store(entry);
      let next: Journal;
      try { check(); const hash = await provider.request.call(provider.provider, { method: "eth_sendTransaction", params: [original.request!] });
        next = { ...entry, stage: isTransactionHash(hash) ? "pending" : "hash-missing", transactionHash: isTransactionHash(hash) ? hash : null, updatedAt: Date.now() }; store(next);
      } catch (e) { store({ ...entry, stage: testWalletErrorCode(e) === 4001 ? "wallet-rejected" : "hash-missing", updatedAt: Date.now() }); throw e; }
      setReview(null); reload(); setSelected(next.review.reviewHash); await recover(next, next.transactionHash ?? undefined);
    });
  }
  return { wallet, review, journals, current: journals.find(j => j.review.reviewHash === selected) ?? journals[0], enteredHash,
    setEnteredHash, setSelected, message, busy, connect, invalidate, run, prepare, confirm, recover, cancel: () => { setReview(null); } };
}

export function TreasuryTransactionPanel({ execution }: { execution: ReturnType<typeof useTreasuryExecution> }) {
  const { review, busy, current, journals } = execution;
  return <>
    {review && <section className="lpReview lpForm" aria-label="Project treasury transaction review"><h3>Review {review.operation.replaceAll("-", " ")}</h3>
      <dl className="lpFacts"><dt>Network</dt><dd>31337 · synthetic assets</dd><dt>Acting wallet</dt><dd className="lpAddress">{review.actor}</dd>
        <dt>Project treasury</dt><dd className="lpAddress">{review.treasury}</dd><dt>Controller</dt><dd className="lpAddress">{review.controller}</dd>
        <dt>Exact action terms</dt><dd><pre className="lpAddress">{JSON.stringify(review.args, null, 2)}</pre></dd>
        <dt>Maximum network cost</dt><dd>{review.status === "prepared" ? earningsAmount(review.maximumNetworkFeeWei) : "Unavailable until authorized Safe execution is prepared"}</dd></dl>
      {review.kind === "safe-inner" && <p className="lpInlineNotice">This controller is a Safe. Its EOA owners cannot call as the Safe. The inner CALL is provided for the Safe&apos;s own authorization flow; direct execution is unavailable here.</p>}
      <details><summary>Exact transaction and runtime</summary><pre className="lpAddress">{JSON.stringify(review.request ?? review.innerCall, null, 2)}</pre><code className="lpAddress">{review.targetRuntimeHash}</code></details>
      {review.notices.map((text, i) => <p key={i}>{text}</p>)}
      <div className="lpDraftActions">{review.status === "prepared" && <button type="button" className="lpButton" disabled={busy} onClick={() => void execution.run(execution.confirm)}>Confirm synthetic treasury transaction</button>}
        <button type="button" className="lpTextButton" disabled={busy} onClick={execution.cancel}>Cancel treasury review</button></div>
    </section>}
    {current && <details className="lpRecovery lpForm" open aria-label="Project treasury transaction recovery"><summary>Recover original treasury transaction</summary>
      <label>Original treasury request<select aria-label="Original treasury request" disabled={busy} value={current.review.reviewHash} onChange={e => { execution.setSelected(e.target.value); execution.setEnteredHash(""); }}>
        {journals.map(j => <option key={j.review.reviewHash} value={j.review.reviewHash}>{j.review.operation} · nonce {j.review.request?.nonce} · {j.stage}</option>)}</select></label>
      <code className="lpAddress">{current.transactionHash ?? "Original hash unavailable; bounded account/nonce recovery is retained."}</code>
      <p>State: {current.stage}. Returning here never requests another signature.</p>
      <label>Original transaction hash<input aria-label="Original treasury transaction hash" value={execution.enteredHash} maxLength={66} spellCheck={false} onChange={e => execution.setEnteredHash(e.target.value)} /></label>
      <button type="button" className="lpButton lpSecondary" disabled={busy} onClick={() => void execution.run(() => execution.recover(current))}>Recover treasury receipt</button>
    </details>}
    {execution.message && <p role="status" className="lpInlineNotice">{execution.message}</p>}
  </>;
}

export function TreasuryWalletControls({ snapshot, onChanged, fixture = false }: { snapshot: ProjectTreasurySnapshot; onChanged(): void; fixture?: boolean }) {
  const execution = useTreasuryExecution({ fixture, treasury: snapshot.treasury,
    expected: { proof: snapshot.proof, controller: snapshot.controller, controllerKind: snapshot.controllerKind }, onChanged });
  const [incoming, setIncoming] = useState(""), [withdrawAsset, setWithdrawAsset] = useState("0x0000000000000000000000000000000000000000"),
    [recipient, setRecipient] = useState(""), [amount, setAmount] = useState("");
  const prepare = (operation: ProjectTreasuryOperation, args: Record<string, string | number | boolean> = {}) => void execution.run(() => execution.prepare(operation, args));
  const change = () => execution.invalidate();
  return <section className="lpPanel lpForm lpTreasuryControls" aria-label="Treasury controller actions"><h2>Controller actions</h2>
    <p>{fixture ? "Isolated controller review. Each action requires a separate explicit wallet confirmation." : "Read-only. Controller transactions and wallet signing are not activated."}</p>
    {!execution.wallet && <button type="button" className="lpButton lpSecondary" disabled={!fixture || execution.busy} onClick={() => void execution.connect()}>Connect synthetic treasury controller</button>}
    {execution.wallet && <p className="lpAddress">Selected wallet: {execution.wallet.account}</p>}
    <div className="lpDraftActions">{(["bind-project", "claim-curve", "collect-lp", "claim-lp", "claim-lp-native", "claim-lp-token"] as const).map(op => <button key={op} className="lpButton lpSecondary"
      disabled={!fixture || !execution.wallet || execution.busy || op === "bind-project" && snapshot.project.status === "bound"}
      onClick={() => prepare(op)}>{({ "bind-project": "Bind verified launch", "claim-curve": "Review curve claim", "collect-lp": "Review LP collection", "claim-lp": "Review LP ETH + token claim", "claim-lp-native": "Review LP ETH claim", "claim-lp-token": "Review LP token claim" })[op]}</button>)}</div>
    <p className="lpInlineNotice">Purchase intent: {treasuryPurchaseIntentLabel(snapshot.purchases.enabled)}. Buy execution unavailable. {snapshot.purchases.reason} This control only records or revokes intent; it cannot activate buys.</p>
    <button type="button" className="lpButton lpSecondary" disabled={!fixture || !execution.wallet || execution.busy} onClick={() => prepare("set-purchases", { enabled: !snapshot.purchases.enabled })}>
      {treasuryPurchaseIntentAction(snapshot.purchases.enabled)}</button>
    <details className="lpForm"><summary>Controller recovery and delayed withdrawal</summary>
      <p>Rotation and withdrawals use separate onchain notices and exact recipients. None can remove the launchpad&apos;s permanently locked LP principal.</p>
      <label>Incoming controller<input aria-label="Incoming treasury controller" value={incoming} maxLength={42} onChange={e => { change(); setIncoming(e.target.value); }} spellCheck={false} /></label>
      <button type="button" className="lpButton lpSecondary" disabled={!fixture || !execution.wallet || execution.busy} onClick={() => prepare("schedule-controller", { incoming })}>Review controller rotation</button>
      {snapshot.rotation && <><p className="lpAddress">Scheduled incoming {snapshot.rotation.incoming} · ready {new Date(Number(snapshot.rotation.readyAt) * 1000).toISOString()} · expires {new Date(Number(snapshot.rotation.expiresAt) * 1000).toISOString()}</p>
        <div className="lpDraftActions"><button type="button" className="lpButton lpSecondary" disabled={!fixture || !execution.wallet || execution.busy} onClick={() => prepare("cancel-controller")}>Review cancelling rotation</button>
          <button type="button" className="lpButton lpSecondary" disabled={!fixture || !execution.wallet || execution.busy} onClick={() => prepare("accept-controller")}>Review accepting controller role</button></div></>}
      <label>Withdrawal asset<select aria-label="Treasury withdrawal asset" value={withdrawAsset} onChange={e => { change(); setWithdrawAsset(e.target.value); }}>{snapshot.assets.filter(a => a.support !== "unsupported").map(a =>
        <option key={a.address ?? "native"} value={a.address ?? "0x0000000000000000000000000000000000000000"}>{a.symbol} · {a.address ?? "native ETH"}</option>)}</select></label>
      <label>Withdrawal recipient<input aria-label="Treasury withdrawal recipient" value={recipient} maxLength={42} spellCheck={false} onChange={e => { change(); setRecipient(e.target.value); }} /></label>
      <label>Exact withdrawal amount (base units)<input aria-label="Treasury withdrawal amount" value={amount} maxLength={78} inputMode="numeric" onChange={e => { change(); setAmount(e.target.value); }} /></label>
      <button type="button" className="lpButton lpSecondary" disabled={!fixture || !execution.wallet || execution.busy} onClick={() => prepare("schedule-withdrawal", { asset: withdrawAsset, recipient, amountWei: amount })}>Review delayed withdrawal</button>
      {snapshot.withdrawals.map(w => <div className="lpForm" key={w.id}><code className="lpAddress">{w.amountWei} base units · {w.asset} → {w.recipient}</code><p>Ready {new Date(Number(w.readyAt) * 1000).toISOString()} · expires {new Date(Number(w.expiresAt) * 1000).toISOString()}</p>
        <div className="lpDraftActions"><button type="button" className="lpButton lpSecondary" disabled={!fixture || !execution.wallet || execution.busy} onClick={() => prepare("cancel-withdrawal", { id: w.id })}>Review cancelling withdrawal</button>
          <button type="button" className="lpButton lpSecondary" disabled={!fixture || !execution.wallet || execution.busy} onClick={() => prepare("execute-withdrawal", { id: w.id })}>Review executing withdrawal</button></div></div>)}
    </details>
    <TreasuryTransactionPanel execution={execution} />
  </section>;
}
