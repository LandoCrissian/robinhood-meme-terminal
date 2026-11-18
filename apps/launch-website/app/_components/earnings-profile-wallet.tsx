"use client";

import { useEffect, useRef, useState } from "react";
import { isClaimExecutionReview, type ClaimExecutionReview, type ClaimWalletKind } from "../../lib/claim-profiles";
import { applyClaimSettlement, claimResourceLocks, claimProfileApiPath, listClaimJournals, submitIsolatedClaim, type ClaimRecoveryJournal } from "../../lib/claim-recovery";
import { earningsAmount, sameEarningsAddress as same } from "../../lib/earnings";
import type { EarningsClaimOperation } from "../../lib/earnings-claims";
import type { ClaimSettlementResult } from "../../lib/production-claims";
import { isLocalTestWallet, isTransactionHash } from "../../lib/test-creation";
import { connectTestWallet, subscribeTestWallet, testProviderAtWindow, testWalletErrorCode, type TestWallet } from "../../lib/test-wallet";
import type { EarningsContractSnapshot, FactoryCreationFees } from "../../lib/server/earnings-contracts";

const labels: Record<EarningsClaimOperation, string> = { "curve-claim": "Curve ETH claim", "lp-collect": "Collect original-position LP fees",
  "lp-claim": "LP ETH + token claim", "lp-claim-native": "LP ETH-only claim", "lp-claim-token": "LP token-only claim", "creation-fees": "Release creation fees to Operations" };
const profileNames: Record<ClaimWalletKind, string> = { eoa: "Direct EOA", "metamask-7702": "MetaMask delegated account", "safe-1.4.1": "SafeL2 1.4.1 · 2-of-3" };
const notification = "rmt:claim-profiles-journal";
async function post(body: object) {
  if (!isLocalTestWallet(window.location)) throw Error("Isolated chain-31337 test origin required");
  const r = await fetch(claimProfileApiPath, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw Error(r.status === 429 ? "Claim evidence reads are temporarily limited. Preserve the original request." : "Claim profile evidence is unavailable.");
  return r.json() as Promise<Record<string, unknown>>;
}
function description(j: ClaimRecoveryJournal) {
  const r = j.verification;
  if (r?.providers.status === "conflict") return "Providers disagree. Settlement is unavailable; the original transaction remains recoverable.";
  if (j.stage === "awaiting-wallet") return "Awaiting the explicit synthetic wallet decision.";
  if (j.stage === "wallet-rejected") return j.review.kind === "safe-1.4.1"
    ? "Outer wallet request rejected. Safe approvals may remain valid until its nonce is consumed; rejection does not revoke them."
    : "Wallet request rejected. No retry or signature will be requested automatically.";
  if (j.stage === "hash-missing") return "The wallet did not return a usable hash. Recover this original request by its payer and nonce.";
  if (j.stage === "submitted") return "Submitted or awaiting a receipt. No automatic resubmission.";
  if (j.stage === "receipt-observed") return "Receipt observed. Exact payment or trace evidence is incomplete; settlement remains pending.";
  if (j.stage === "indexing-pending") return "Payment proven at the observed L2 block. Exact fee-history indexing is pending.";
  if (j.stage === "canonical-l2") return "Payment and indexing verified at the observed L2 block. Production L1 finality is not established.";
  if (j.stage === "settled") return "Settled only under the named synthetic-local policy. This is not production or Ethereum finality.";
  if (j.stage === "reverted") return r?.outerReceiptStatus === "success" && r.innerExecution === "reverted"
    ? "The outer Safe transaction confirmed, but its inner claim failed. No successful claim settlement is reported."
    : "The original transaction reverted. No claim payment was settled.";
  return "Evidence unavailable or invalidated by a reorg. Keep the original request and hash; it will not be resent.";
}
export function EarningsProfileWallet({ token, factory, beneficiary, snapshot, factoryFees, onSettled, recoveryOnly = false, showRecovery = true }: {
  token?: string; factory?: string; beneficiary: string; snapshot?: EarningsContractSnapshot; factoryFees?: FactoryCreationFees;
  onSettled: (token?: string) => void; recoveryOnly?: boolean; showRecovery?: boolean;
}) {
  const boundFactory = factoryFees?.factory ?? factory ?? "";
  const initialKind: ClaimWalletKind = snapshot?.rights.accountType === "contract" ? "safe-1.4.1" : snapshot?.rights.accountType === "delegated-eoa" ? "metamask-7702" : "eoa";
  const [wallet, setWallet] = useState<TestWallet | null>(null), [kind, setKind] = useState(initialKind);
  const [operation, setOperation] = useState<EarningsClaimOperation>(factoryFees ? "creation-fees" : "curve-claim");
  const [review, setReview] = useState<ClaimExecutionReview | null>(null), [safeAddress, setSafeAddress] = useState(beneficiary), [signatures, setSignatures] = useState("");
  const [journals, setJournals] = useState<ClaimRecoveryJournal[]>([]), [selected, setSelected] = useState(""), [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const lock = useRef(false), revision = useRef(0);
  const current = journals.find(j => j.review.intentHash === selected) ?? journals[0];
  const lp = snapshot?.lp.status === "ready" ? snapshot.lp : null;
  const choices: EarningsClaimOperation[] = factoryFees ? ["creation-fees"] : ["curve-claim", ...(lp ? ["lp-collect", "lp-claim", "lp-claim-native", "lp-claim-token"] as const : [])];
  const reload = () => { setJournals(listClaimJournals(localStorage, boundFactory)); };
  useEffect(() => {
    const load = () => { try {
      const entries = listClaimJournals(localStorage, boundFactory); setJournals(entries);
      const latest = entries.find(j => (recoveryOnly || j.review.inner.operation === operation)
        && (recoveryOnly || (token ? same(j.review.inner.token, token) : j.review.inner.operation === "creation-fees"))
        && (!wallet || same(j.review.gasPayer, wallet.account)));
      if (latest && ["canonical-l2", "settled", "reverted"].includes(latest.stage)) setMessage("");
    } catch { setMessage("Recovery storage is unavailable. Submission is blocked until the original intent is recovered."); } };
    load(); window.addEventListener(notification, load); window.addEventListener("storage", load);
    return () => { window.removeEventListener(notification, load); window.removeEventListener("storage", load); };
  }, [boundFactory, recoveryOnly, operation, token, wallet]);
  useEffect(() => () => { revision.current++; }, []);
  useEffect(() => {
    revision.current++; setReview(null); setSignatures("");
  }, [boundFactory, token, beneficiary, operation, kind, safeAddress, snapshot?.observed.blockHash, factoryFees?.observed.blockHash]);
  useEffect(() => {
    if (!wallet) return;
    return subscribeTestWallet(wallet, () => {
      revision.current++; setReview(null); setWallet(null);
      setMessage("Wallet account or network changed. Previously submitted claims retain their original identity.");
    });
  }, [wallet]);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    try { await fn(); }
    catch (e) {
      const rejected = testWalletErrorCode(e) === 4001;
      if (!rejected) setReview(null);
      setMessage(rejected ? "Wallet request rejected. The reviewed request is retained for an explicit retry. No signature will be requested automatically." : e instanceof Error ? e.message : "Claim verification unavailable.");
      try { reload(); window.dispatchEvent(new Event(notification)); } catch { /* No resubmission on storage failure. */ }
    } finally { lock.current = false; setBusy(false); }
  }
  async function withLock(r: ClaimExecutionReview, fn: () => Promise<void>) {
    if (!navigator.locks?.request) throw Error("This browser cannot safely coordinate claims. No wallet request was made.");
    const resources = claimResourceLocks(r);
    const acquire = async (index: number): Promise<void> => {
      if (index === resources.length) return fn();
      await navigator.locks.request(resources[index], { mode: "exclusive", ifAvailable: true }, async granted => {
        if (!granted) throw Error("Another tab is handling this payer or Safe nonce. Recover its original request.");
        await acquire(index + 1);
      });
    };
    await acquire(0);
  }
  async function prepare(approved?: string) {
    if (!wallet) throw Error("Connect a synthetic gas-payer wallet first.");
    const version = revision.current, prior = approved ? review : null;
    const r = await post({ action: "prepare", account: wallet.account, beneficiary, operation, kind,
      ...(token ? { token } : {}), ...(kind === "safe-1.4.1" ? { safeAddress } : {}), ...(approved ? { safeSignatures: approved, prior } : {}) });
    if (version !== revision.current) throw Error("The wallet or review changed while preflight was running.");
    if (!isClaimExecutionReview(r) || r.chainId !== 31337 || r.scope !== "isolated-local" || r.kind !== kind || r.inner.operation !== operation
      || !same(r.inner.factory, boundFactory) || !same(r.gasPayer, wallet.account) || (token && !same(r.inner.token, token))) {
      throw Error("The claim profile, immutable terms or fee evidence could not be verified.");
    }
    const expectedTarget = factoryFees ? factoryFees.factory : operation === "curve-claim" ? snapshot?.curve.ledger
      : operation === "lp-collect" ? lp?.collectionContract : lp?.ledger;
    const expectedHash = factoryFees ? r.inner.factoryRuntimeHash : operation === "curve-claim" ? snapshot?.curve.runtimeHash
      : operation === "lp-collect" ? lp?.collectionRuntimeHash : lp?.runtimeHash;
    const expectedRecipient = factoryFees ? factoryFees.recipient : operation === "lp-collect" ? lp?.ledger : beneficiary;
    if (!expectedTarget || !same(r.inner.to, expectedTarget) || !expectedHash || !same(r.inner.targetRuntimeHash, expectedHash)
      || !expectedRecipient || !same(r.inner.beneficiary, expectedRecipient)
      || (!factoryFees && (!snapshot || !same(r.inner.originCurve, snapshot.originalCurve) || !same(r.inner.discoveryRecipient, beneficiary)))
      || (operation.startsWith("lp-") && (!lp || r.inner.positionTokenId !== lp.positionTokenId || r.inner.principalLiquidityWei !== lp.liquidityWei))) {
      throw Error("The reviewed target, recipient, original ledger or locked position differs from the checked project.");
    }
    if (!r.wallet.safe && !same(r.actor, wallet.account)) throw Error("The direct claimant differs from the wallet.");
    if (r.wallet.safe && !same(r.actor, safeAddress)) throw Error("The Safe account differs from the reviewed beneficiary.");
    setReview(r);
  }
  async function recover(entry: ClaimRecoveryJournal, entered?: string) {
    const transactionHash = entered || entry.transactionHash;
    if (transactionHash && !isTransactionHash(transactionHash)) throw Error("Enter the complete original transaction hash.");
    const result = await post({ action: "verify", review: entry.review, ...(transactionHash ? { transactionHash } : {}) });
    const next = applyClaimSettlement(localStorage, entry, result as ClaimSettlementResult);
    reload(); setSelected(next.review.intentHash); window.dispatchEvent(new Event(notification));
    setMessage(description(next));
    // Updating balances never changes the original submitted review or hash.
    if (["canonical-l2", "settled", "indexing-pending", "reverted", "unavailable"].includes(next.stage)) {
      onSettled(next.review.inner.operation === "creation-fees" ? undefined : next.review.inner.token);
    }
  }
  async function confirm() {
    if (!wallet || !review || review.status !== "review-only") throw Error("A complete current synthetic review is required.");
    const original = review, version = revision.current;
    const check = () => {
      if (version !== revision.current || testProviderAtWindow() !== wallet.provider || wallet.provider.request !== wallet.request) throw Error("The wallet or selected review changed.");
    };
    await withLock(original, async () => {
      const entry = await submitIsolatedClaim({ review: original, storage: localStorage, location: window.location,
        wallet: { request: async input => { check(); const r = await wallet.request.call(wallet.provider, input); if (input.method !== "eth_sendTransaction") check(); return r; } },
        revalidate: async prior => { check(); const r = await post({ action: "revalidate", review: prior }); check(); return r as { status: string; reviewHash?: `0x${string}` }; },
        reconcilePrior: async prior => await post({ action: "verify", review: prior.review,
          ...(prior.transactionHash ? { transactionHash: prior.transactionHash } : {}) }) as ClaimSettlementResult });
      setReview(null); reload(); setSelected(entry.review.intentHash); window.dispatchEvent(new Event(notification));
      await recover(entry);
    });
  }
  if (recoveryOnly && !journals.length && !message) return null;
  return <section className="lpEarningsClaim lpForm" aria-label={factoryFees ? "Creation-fee profile review" : recoveryOnly ? "Claim profile recovery" : "Wallet execution profile"}>
    {!recoveryOnly && <>
      <p className="lpInlineNotice">Isolated wallet-profile test · chain 31337 · synthetic assets. Public financial execution remains disabled.</p>
      {!wallet ? <button className="lpButton lpSecondary" disabled={busy} onClick={() => void run(async () => { setWallet(await connectTestWallet()); })}>Connect synthetic claim wallet</button>
        : <p className="lpAddress">Gas payer: {wallet.account}</p>}
      <label>Operation<select aria-label="Claim profile operation" disabled={busy} value={operation} onChange={e => setOperation(e.target.value as EarningsClaimOperation)}>{choices.map(op => <option key={op} value={op}>{labels[op]}</option>)}</select></label>
      <label>Wallet profile<select aria-label="Claim wallet profile" disabled={busy} value={kind} onChange={e => setKind(e.target.value as ClaimWalletKind)}>{Object.entries(profileNames).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      {kind === "safe-1.4.1" && <label>Safe account<input aria-label="Claim Safe address" value={safeAddress} maxLength={42} spellCheck={false} disabled={busy || !["lp-collect", "creation-fees"].includes(operation)} onChange={e => setSafeAddress(e.target.value)} /></label>}
      {review ? <div className="lpReview" aria-label="Wallet profile review"><h3>Review {labels[operation].toLowerCase()}</h3>
        <dl className="lpFacts"><dt>Wallet profile</dt><dd>{profileNames[review.kind]}</dd><dt>Network</dt><dd>31337 · synthetic</dd>
          <dt>Receiving beneficiary</dt><dd className="lpAddress">{review.beneficiary}</dd><dt>Ledger caller</dt><dd className="lpAddress">{review.actor}</dd>
          <dt>External gas payer</dt><dd className="lpAddress">{review.gasPayer}</dd><dt>Call target</dt><dd className="lpAddress">{review.inner.to}</dd>
          <dt>Current ETH amount</dt><dd>{earningsAmount(review.inner.expectedNativeWei)}</dd><dt>ETH amount (wei)</dt><dd className="lpAddress">{review.inner.expectedNativeWei}</dd><dt>ERC-20 amount (wei)</dt><dd className="lpAddress">{review.inner.expectedTokenWei}</dd>
          <dt>Project asset</dt><dd className="lpAddress">{operation === "creation-fees" ? "Factory-wide ETH payout" : review.inner.token}</dd>
          <dt>Maximum proposed network cost</dt><dd>{review.fees.status === "unavailable" ? "Unavailable — execution blocked" : earningsAmount(review.fees.proposedMaximumWei)}</dd>
          {review.fees.status !== "unavailable" && <><dt>Maximum network cost (wei)</dt><dd className="lpAddress">{review.fees.proposedMaximumWei}</dd><dt>Fee evidence</dt><dd>Synthetic local execution gas · no production L1 fee claim</dd></>}
          <dt>Owner approvals / wallet transactions</dt><dd>{review.authorizations.ownerApprovalsCollected}/{review.authorizations.ownerApprovalsRequired} Safe approvals · 1 separate wallet transaction</dd>
          <dt>Payer nonce</dt><dd>{review.gasPayerEvidence.nonce}</dd>{review.wallet.safe && <><dt>Safe nonce</dt><dd>{review.wallet.safe.nonce}</dd><dt>Safe EVM nonce</dt><dd>{review.wallet.safe.evmNonce}</dd></>}
        </dl>
        {review.wallet.safe && <p className="lpInlineNotice">Safe approvals authorize the Safe&apos;s CALL, not an EOA claim. Ordinary Safe claim signatures have no onchain expiry; rejecting the payer request does not revoke them.</p>}
        {review.status === "awaiting-safe-approvals" && <details className="lpForm" open><summary>Operator test approvals</summary>
          <p>Supply two genuine signatures from this isolated Safe&apos;s test owners. This page does not request owner signatures or hold keys.</p>
          <pre className="lpAddress">{JSON.stringify(review.wallet.safe?.transaction, null, 2)}</pre>
          <p className="lpAddress">Safe transaction hash: {review.wallet.safe?.transactionHash}</p>
          <label>Two Safe test approvals<input aria-label="Safe test approvals" value={signatures} onChange={e => setSignatures(e.target.value)} maxLength={262} spellCheck={false} /></label>
          <button className="lpButton" disabled={busy || !/^0x[0-9a-f]{260}$/i.test(signatures)} onClick={() => void run(() => prepare(signatures))}>Validate synthetic Safe approvals</button>
        </details>}
        {review.fees.status === "unavailable" && <p role="status">{review.fees.reason}</p>}
        <details><summary>Exact calldata, runtime and approval scope</summary><div className="lpForm"><code className="lpAddress">{review.inner.data}</code><code className="lpAddress">{review.inner.targetRuntimeHash}</code><pre className="lpAddress">{JSON.stringify(review.outer, null, 2)}</pre>{review.notices.map(text => <p key={text}>{text}</p>)}</div></details>
        <div className="lpDraftActions">{review.status === "review-only" && <button className="lpButton" disabled={busy} onClick={() => void run(confirm)}>Confirm synthetic claim transaction</button>}
          <button className="lpTextButton" disabled={busy} onClick={() => setReview(null)}>Cancel profile review</button></div>
      </div> : <button className="lpButton" disabled={busy || !wallet} onClick={() => void run(() => prepare())}>Review claim wallet profile</button>}
    </>}
    {showRecovery && current && <details className="lpRecovery" open={!(["settled", "reverted", "canonical-l2"] as string[]).includes(current.stage)}><summary>Recover original profiled claim</summary><div className="lpForm">
      <label>Original claim<select aria-label="Original claim intent" value={current.review.intentHash} disabled={busy} onChange={e => { setSelected(e.target.value); setHash(""); }}>{journals.map(j => <option value={j.review.intentHash} key={j.review.intentHash}>{labels[j.review.inner.operation]} · {j.review.inner.token.slice(0, 8)} · nonce {j.review.gasPayerEvidence.nonce}</option>)}</select></label>
      <p className="lpAddress">Original payer {current.review.gasPayer} · receiving {current.review.beneficiary}</p>
      <p role="status">{description(current)}</p><code className="lpAddress">{current.transactionHash ?? "Original hash unavailable; bounded payer/nonce recovery is retained."}</code>
      <label>Original transaction hash<input aria-label="Original profiled claim hash" maxLength={66} value={hash} onChange={e => setHash(e.target.value)} spellCheck={false} /></label>
      <button className="lpButton lpSecondary" disabled={busy} onClick={() => void run(async () => { await withLock(current.review, () => recover(current, hash.trim() || undefined)); })}>Recover profiled claim receipt</button>
    </div></details>}
    {message && <p role="status" className="lpInlineNotice">{message}</p>}
  </section>;
}
