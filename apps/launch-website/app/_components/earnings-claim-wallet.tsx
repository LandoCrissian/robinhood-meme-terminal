"use client";

import { useEffect, useRef, useState } from "react";
import { earningsAmount, earningsWei, sameEarningsAddress as same } from "../../lib/earnings";
import { claimCalldataMatches, describeContractWalletClaim, earningsClaimPath, isEarningsClaimRequest, readEarningsClaimJournal, sendEarningsClaim, storeEarningsClaimJournal,
  type EarningsClaimJournal, type EarningsClaimOperation, type EarningsClaimVerification, type EarningsPreparedClaim } from "../../lib/earnings-claims";
import { isLocalTestWallet, isTransactionHash } from "../../lib/test-creation";
import { assertTestWalletBinding, connectTestWallet, subscribeTestWallet, testProviderAtWindow, testWalletErrorCode, type TestWallet } from "../../lib/test-wallet";
import type { EarningsContractSnapshot, FactoryCreationFees } from "../../lib/server/earnings-contracts";

const labels: Record<EarningsClaimOperation, string> = {
  "curve-claim": "Curve ETH claim", "lp-collect": "Collect original-position LP fees", "lp-claim": "LP ETH + token claim",
  "lp-claim-native": "LP ETH-only claim", "lp-claim-token": "LP token-only claim", "creation-fees": "Release creation fees to Operations",
};
async function post(body: object) {
  if (!isLocalTestWallet(window.location)) throw new Error("Isolated test origin required");
  const response = await fetch(earningsClaimPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(25_000) });
  const result = await response.json();
  if (!response.ok || result.status === "invalid" || result.status === "rejected") throw new Error("The claim could not be verified. Refresh the contract evidence before reviewing again.");
  return result as Record<string, unknown>;
}
function latestJournal(factory: string, account?: string): EarningsClaimJournal | null {
  // The journal contains only public transaction intent. Never enumerate wallet
  // storage, unrelated local preferences or more than this bounded key prefix.
  const keys = Object.keys(localStorage).filter(key => key.startsWith("rmt.earnings.pending.v1:")).slice(0, 64);
  const entries: EarningsClaimJournal[] = [];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key); if (!raw || raw.length > 8192) continue;
      const value = JSON.parse(raw) as EarningsClaimJournal;
      if (!isEarningsClaimRequest(value.request) || !same(value.request.factory, factory) || (account && !same(value.request.from, account))) continue;
      const entry = readEarningsClaimJournal(localStorage, value.request); if (entry) entries.push(entry);
    } catch { /* Malformed data never authorizes signing. */ }
  }
  return entries.sort((a, b) => Number(["confirmed", "reverted"].includes(a.state)) - Number(["confirmed", "reverted"].includes(b.state)) || b.updatedAt - a.updatedAt)[0] ?? null;
}

export function EarningsClaimWallet({ token, factory, beneficiary, snapshot, factoryFees, onSettled, recoveryOnly = false, showRecovery = true }: {
  token?: string; factory?: string; beneficiary: string; snapshot?: EarningsContractSnapshot; factoryFees?: FactoryCreationFees; onSettled: (token?: string) => void;
  recoveryOnly?: boolean; showRecovery?: boolean;
}) {
  const boundFactory = factoryFees?.factory ?? factory ?? "";
  const [wallet, setWallet] = useState<TestWallet | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [operation, setOperation] = useState<EarningsClaimOperation>(factoryFees ? "creation-fees" : "curve-claim");
  const [prepared, setPrepared] = useState<EarningsPreparedClaim | null>(null), [journal, setJournal] = useState<EarningsClaimJournal | null>(null);
  const [hash, setHash] = useState("");
  const [handoff, setHandoff] = useState<{ snapshot: EarningsContractSnapshot; operation: EarningsClaimOperation;
    value: Awaited<ReturnType<typeof describeContractWalletClaim>> } | null>(null);
  const locked = useRef(false), version = useRef(0);
  useEffect(() => () => { version.current++; }, []);
  useEffect(() => {
    const load = () => {
      try {
        const latest = latestJournal(boundFactory);
        setJournal(latest);
        if (latest && ["confirmed", "reverted"].includes(latest.state)
          && (recoveryOnly || latest.request.operation === operation)
          && (token ? same(latest.request.token, token) : recoveryOnly || latest.request.operation === "creation-fees")
          && (!wallet || same(latest.request.from, wallet.account))) {
          // Another card can reconcile the same original request. Remove the
          // superseded local error, without inferring indexed activity or new
          // payment evidence from a browser journal alone.
          setMessage("");
        }
      } catch { setMessage("Browser storage is unavailable. A transaction cannot be safely submitted."); }
    };
    load(); window.addEventListener("rmt:earnings-journal", load);
    return () => window.removeEventListener("rmt:earnings-journal", load);
  }, [boundFactory, token, operation, recoveryOnly, wallet]);
  useEffect(() => {
    if (!wallet) return;
    return subscribeTestWallet(wallet, () => {
      version.current++; setPrepared(null); setWallet(null);
      setMessage("The wallet account or network changed. Submitted requests retain their original account and recovery identity.");
    });
  }, [wallet]);
  useEffect(() => { version.current++; setPrepared(null); }, [boundFactory, token, beneficiary, operation, snapshot?.observed.blockHash,
    snapshot?.rights.accountType, factoryFees?.observed.blockHash]);
  useEffect(() => {
    let cancelled = false;
    setHandoff(null);
    if (!recoveryOnly && snapshot?.rights.accountType === "contract" && same(snapshot.beneficiary, beneficiary)
      && (!token || same(snapshot.token, token)) && !["lp-collect", "creation-fees"].includes(operation)) {
      // Pure encoding of the already verified snapshot: this does not connect a
      // wallet, request a signature or prepare an outer contract-wallet action.
      void describeContractWalletClaim(snapshot, operation).then(value => {
        if (!cancelled) setHandoff({ snapshot, operation, value });
      }).catch(() => { /* Incomplete or inconsistent evidence yields no handoff. */ });
    }
    return () => { cancelled = true; };
  }, [snapshot, operation, recoveryOnly, beneficiary, token]);
  const beneficiaryClaimBlocked = !["lp-collect", "creation-fees"].includes(operation) && snapshot?.rights.accountType !== "eoa";
  async function run(task: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage("");
    try { await task(); }
    catch (e) {
      setPrepared(null);
      setMessage(testWalletErrorCode(e) === 4001 ? "Wallet request rejected. No new signature will be requested automatically."
        : e instanceof Error ? e.message : "Earnings transaction evidence unavailable.");
      try { setJournal(latestJournal(boundFactory)); window.dispatchEvent(new Event("rmt:earnings-journal")); } catch { /* Submission is blocked when persistence fails. */ }
    } finally { locked.current = false; setBusy(false); }
  }
  async function withAccountLock(account: string, task: () => Promise<void>) {
    if (!navigator.locks?.request) throw new Error("This browser cannot safely coordinate earnings transactions. Use a compatible wallet browser; no signature was requested.");
    const name = `rmt.earnings.pending.v1:0x7a69:${boundFactory.toLowerCase()}:${account.toLowerCase()}`;
    await navigator.locks.request(name, { mode: "exclusive", ifAvailable: true }, async lock => {
      if (!lock) throw new Error("Another card or tab is handling this account. Recover its original transaction before retrying.");
      await task();
    });
  }
  async function recover(entry: EarningsClaimJournal, enteredHash?: string, refresh = true) {
    const value = enteredHash || entry.transactionHash;
    if (value && !isTransactionHash(value)) throw new Error("Enter the original complete transaction hash.");
    const r = await post({ action: "verify", request: entry.request, ...(value ? { transactionHash: value } : {}) }) as EarningsClaimVerification;
    if (!["pending", "confirmed", "reverted", "unavailable"].includes(r.status) || (r.transactionHash && !isTransactionHash(r.transactionHash))
      || (value && r.transactionHash && !same(value, r.transactionHash))) throw new Error("Receipt identity could not be verified.");
    const next: EarningsClaimJournal = { ...entry, transactionHash: r.transactionHash ?? entry.transactionHash,
      state: r.status === "confirmed" ? "confirmed" : r.status === "reverted" ? "reverted" : entry.state === "confirmed" ? "submitted" : entry.state, updatedAt: Date.now() };
    storeEarningsClaimJournal(localStorage, next); setJournal(next); window.dispatchEvent(new Event("rmt:earnings-journal"));
    setMessage(r.status === "confirmed" ? `Test claim confirmed onchain. ${r.indexed ? "Canonical fee activity indexed." : "Fee-history indexing pending."}`
      : r.status === "reverted" ? "The original transaction reverted. No claim was settled; review fresh state for a separate retry."
      : r.settlementPending ? "Receipt observed; exact payment settlement is still unproven. Keep the original transaction pending."
      : r.status === "unavailable" ? "Receipt evidence is unavailable or invalidated. The original request remains recoverable."
      : "The original transaction is pending or its hash has not been recovered. It will not be resent automatically.");
    if (refresh && (r.status === "confirmed" || r.status === "reverted")) onSettled(entry.request.operation === "creation-fees" ? undefined : entry.request.token);
    return r;
  }
  async function prepare() {
    if (beneficiaryClaimBlocked) throw new Error("This beneficiary requires its separately verified wallet execution path. Direct EOA submission is unavailable.");
    if (!wallet) throw new Error("Connect the test beneficiary wallet first.");
    const saved = latestJournal(boundFactory, wallet.account);
    if (saved) {
      setJournal(saved);
      if (!["confirmed", "reverted"].includes(saved.state)) throw new Error("Recover the original pending transaction before reviewing another claim.");
      let verified: EarningsClaimVerification | undefined;
      // Validating an old terminal receipt must not start an asynchronous balance
      // refresh that invalidates the fresh review being prepared immediately below.
      await withAccountLock(saved.request.from, async () => { verified = await recover(saved, undefined, false); });
      if (verified?.status !== "confirmed" && verified?.status !== "reverted") throw new Error("The previous receipt must be reconciled before another claim.");
    }
    const current = version.current;
    const r = await post({ action: "prepare", account: wallet.account, beneficiary, operation, ...(token ? { token } : {}) }) as unknown as EarningsPreparedClaim;
    const lp = snapshot?.lp.status === "ready" ? snapshot.lp : null;
    const expectedTarget = operation === "creation-fees" ? factoryFees?.factory : operation === "curve-claim" ? snapshot?.curve.ledger
      : operation === "lp-collect" ? lp?.collectionContract : lp?.ledger;
    const expectedRuntime = operation === "curve-claim" ? snapshot?.curve.runtimeHash : operation === "lp-collect" ? lp?.collectionRuntimeHash
      : operation === "creation-fees" ? r.request?.factoryRuntimeHash : lp?.runtimeHash;
    const expectedBeneficiary = operation === "creation-fees" ? factoryFees?.recipient : operation === "lp-collect" ? lp?.ledger : beneficiary;
    if (r.status !== "prepared" || !isEarningsClaimRequest(r.request) || !await claimCalldataMatches(r.request)
      || !same(r.request.factory, boundFactory) || !same(r.request.from, wallet.account) || r.request.operation !== operation
      || !expectedTarget || !same(r.request.to, expectedTarget) || !expectedRuntime || !same(r.request.targetRuntimeHash, expectedRuntime)
      || !expectedBeneficiary || !same(r.request.beneficiary, expectedBeneficiary)
      || (operation !== "creation-fees" && !same(r.request.discoveryRecipient, beneficiary))
      || r.request.chainId !== "0x7a69" || (token && !same(r.request.token, token))
      || !r.quote || ![r.quote.gasUnits, r.quote.gasPriceWei, r.quote.estimatedNetworkFeeWei].every(earningsWei)
      || r.quote.estimatedNetworkFeeWei !== (BigInt(r.quote.gasUnits) * BigInt(r.quote.gasPriceWei)).toString()
      || r.quote.transactions !== 1) throw new Error("Unsigned claim did not match the reviewed project, account or network.");
    if (version.current !== current) throw new Error("Review invalidated by an account or project change.");
    setPrepared(r);
  }
  async function confirm() {
    if (beneficiaryClaimBlocked) throw new Error("This beneficiary requires its separately verified wallet execution path. Direct EOA submission is unavailable.");
    if (!prepared || !wallet || !isLocalTestWallet(window.location)) throw new Error("A current isolated review is required.");
    const original = prepared;
    const current = version.current;
    const stillCurrent = () => {
      if (current !== version.current || testProviderAtWindow() !== wallet.provider || wallet.provider.request !== wallet.request) throw new Error("The wallet or reviewed operation changed.");
    };
    await assertTestWalletBinding(wallet, { blockNumber: original.request.deploymentBlockNumber, blockHash: original.request.deploymentBlockHash,
      reviewBlockNumber: original.request.reviewBlockNumber, reviewBlockHash: original.request.reviewBlockHash });
    const entry = await sendEarningsClaim({ request: original.request, quote: original.quote, storage: localStorage, location: window.location,
      wallet: { request: async input => { stillCurrent(); const result = await wallet.request.call(wallet.provider, input); if (input.method !== "eth_sendTransaction") stillCurrent(); return result; } },
      revalidate: async prior => {
        if (prepared !== original || !same(wallet.account, prior.from)) throw new Error("The wallet review changed.");
        const r = await post({ action: "prepare", account: prior.from, beneficiary: prior.discoveryRecipient, operation: prior.operation,
          ...(prior.operation !== "creation-fees" ? { token: prior.token } : {}), prior });
        stillCurrent();
        return r as unknown as EarningsPreparedClaim;
      } });
    setPrepared(null); setJournal(entry); window.dispatchEvent(new Event("rmt:earnings-journal"));
    await recover(entry);
  }
  const lp = snapshot?.lp.status === "ready" ? snapshot.lp : null;
  const choices: EarningsClaimOperation[] = factoryFees ? ["creation-fees"] : ["curve-claim", ...(lp ? ["lp-collect", "lp-claim", "lp-claim-native", "lp-claim-token"] as const : [])];
  const noCredit = operation === "curve-claim" ? snapshot?.curve.claimableNativeWei === "0"
    : operation === "creation-fees" ? factoryFees?.availableNativeWei === "0"
    : operation === "lp-collect" ? !!lp && lp.uncollectedNativeWei === "0" && lp.uncollectedTokenWei === "0"
    : operation === "lp-claim-native" ? lp?.claimableNativeWei === "0" : operation === "lp-claim-token" ? lp?.claimableTokenWei === "0"
    : !!lp && lp.claimableNativeWei === "0" && lp.claimableTokenWei === "0";
  const contractBeneficiary = snapshot?.rights.accountType === "contract" && beneficiaryClaimBlocked;
  const delegatedBeneficiary = snapshot?.rights.accountType === "delegated-eoa" && beneficiaryClaimBlocked;
  const currentHandoff = handoff && handoff.snapshot === snapshot && handoff.operation === operation ? handoff.value : null;
  if (recoveryOnly && !journal) return null;
  return <section className="lpEarningsClaim lpForm" aria-label={factoryFees ? "Creation-fee test release" : "Earnings test transaction"}>
    {!recoveryOnly && <>
    <p className="lpInlineNotice">Synthetic test execution only · Anvil 31337. Each operation is one separate wallet transaction.</p>
    {!wallet ? <button className="lpButton lpSecondary" disabled={busy} onClick={() => void run(async () => { setWallet(await connectTestWallet()); })}>Connect test claim wallet</button>
      : <p className="lpAddress">Test signer: {wallet.account}</p>}
    <label>Operation<select aria-label="Earnings operation" value={operation} disabled={busy} onChange={e => { version.current++; setPrepared(null); setOperation(e.target.value as EarningsClaimOperation); }}>{choices.map(op => <option key={op} value={op}>{labels[op]}</option>)}</select></label>
    {contractBeneficiary && <>
      <p className="lpInlineNotice">These credits belong to the contract wallet. Its EOA owners cannot claim directly. The wallet&apos;s own authorized execution path must make the claim; direct submission is unavailable here.</p>
      {currentHandoff && <details><summary>Unsigned contract-wallet claim handoff</summary>
        <p>This is an inner CALL for the credited contract wallet, not an executable Safe transaction. Its own owners and approval threshold must authorize a separate outer transaction. No signature is requested here.</p>
        <pre className="lpAddress" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><code>{JSON.stringify(currentHandoff, null, 2)}</code></pre>
      </details>}
    </>}
    {delegatedBeneficiary && <p className="lpInlineNotice">This beneficiary is an EIP-7702 delegated account. Its separately verified delegation and execution profile must be accepted before direct claims are available. It is not being treated as a Safe, and no delegation change or signature is requested.</p>}
    {prepared ? <div className="lpReview" aria-label="Earnings transaction review">
      <h3>Review {labels[prepared.request.operation].toLowerCase()}</h3>
      <dl className="lpFacts"><dt>Network</dt><dd>Anvil 31337 · synthetic assets</dd><dt>From</dt><dd className="lpAddress">{prepared.request.from}</dd>
        <dt>To contract</dt><dd className="lpAddress">{prepared.request.to}</dd><dt>Receiving beneficiary</dt><dd className="lpAddress">{prepared.request.beneficiary}</dd>
      <dt>Current native amount</dt><dd>{earningsAmount(prepared.request.expectedNativeWei)}</dd><dt>ETH amount (wei)</dt><dd className="lpAddress">{prepared.request.expectedNativeWei}</dd>
        <dt>Token amount (wei)</dt><dd className="lpAddress">{prepared.request.expectedTokenWei}</dd><dt>Token contract</dt><dd className="lpAddress">{prepared.request.token}</dd>
        <dt>Estimated network cost</dt><dd>{earningsAmount(prepared.quote.estimatedNetworkFeeWei)}</dd><dt>Nonce</dt><dd>{BigInt(prepared.request.nonce).toString()}</dd>
        <dt>Onchain deadline</dt><dd>{prepared.request.deadline ?? "None for this claim; review still expires"}</dd></dl>
      <details><summary>Exact calldata and runtime</summary><code className="lpAddress">{prepared.request.data}</code><code className="lpAddress">{prepared.request.targetRuntimeHash}</code></details>
      <p>Credits may grow before inclusion. The receipt and actual transfers determine payment. The wallet confirms its own network costs.</p>
      <div className="lpDraftActions"><button className="lpButton" disabled={busy || beneficiaryClaimBlocked} onClick={() => void run(async () => { if (!wallet) throw new Error("Connect the original wallet."); await withAccountLock(wallet.account, confirm); })}>Confirm test earnings transaction</button>
        <button className="lpTextButton" disabled={busy} onClick={() => setPrepared(null)}>Cancel review</button></div>
    </div> : <button className="lpButton" disabled={busy || !wallet || noCredit || beneficiaryClaimBlocked} onClick={() => void run(prepare)}>{noCredit ? "No verified credit for this operation" : "Review test earnings transaction"}</button>}
    </>}
    {showRecovery && journal && <details className="lpRecovery" open={!["confirmed", "reverted"].includes(journal.state)}><summary>Recover original earnings transaction</summary><div className="lpForm">
      <p>Original signer <code className="lpAddress">{journal.request.from}</code> · nonce {BigInt(journal.request.nonce).toString()} · {labels[journal.request.operation]}</p>
      <p className="lpAddress">{journal.transactionHash ?? "The wallet did not return a hash. Recover by the original nonce."}</p>
      <label>Original transaction hash (optional)<input aria-label="Original earnings transaction hash" value={hash} onChange={e => setHash(e.target.value)} maxLength={66} spellCheck={false} /></label>
      <button type="button" className="lpButton lpSecondary" disabled={busy} onClick={() => void run(async () => { await withAccountLock(journal.request.from, async () => { await recover(journal, hash.trim() || undefined); }); })}>Recover earnings receipt</button>
    </div></details>}
    {message && <p role="status" className="lpInlineNotice">{message}</p>}
  </section>;
}
