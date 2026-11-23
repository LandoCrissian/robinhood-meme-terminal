"use client";
import { withProductionNonceStore } from "../../lib/production-nonce-store";

import { productionAccountLock } from "../../lib/production-wallet";
import { useAccount } from "./account-provider";
import { descriptionMetadata } from "../../lib/rmt-metadata";
import { verifyArtworkReceipt } from "../../lib/token-artwork";
import { isRmtCreation, rmtCreationOwner, rmtCreationIntent } from "../../lib/owner-creation";


import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isLaunchAddress } from "../../lib/launch-data";
import { type ReviewedLaunchDraft } from "../../lib/launch-draft";

import { isTestCreationPayouts, isTransactionHash, type TestCreationFields, type TestCreationPayouts, type TestCreationVerification } from "../../lib/test-creation";
import { productionCalldataMatches, isProductionWalletOrigin,
  isProductionCreationRequest, sameProductionCreationRequest,
  productionCreationPath, productionCreationJournalKey,
  productionCreationOperating, productionCreationReserve,
  archiveCompletedProductionCreation, readCompletedProductionCreations, completedProductionCreationsKey, type CompletedProductionCreation,
  submitProductionCreation,
  assertProductionWallet, connectProductionWallet,
  productionProviderAtWindow, type ProductionWallet as Wallet,
  type ProductionCreationRequest } from "../../lib/production-creation";
import { sameWalletHex as same, subscribeTestWallet, testWalletErrorCode } from "../../lib/test-wallet";

type Prepared = { draft: ReviewedLaunchDraft; wallet: Wallet; factory: string; request: ProductionCreationRequest; payouts: TestCreationPayouts; gasEstimate: string };
type Journal = { request: ProductionCreationRequest; transactionHash?: `0x${string}` };

const journalKey = productionCreationJournalKey;
function readJournal(): Journal | undefined {
  const raw = localStorage.getItem(journalKey);
  if (!raw) return;
  if (raw.length > 4096) throw new Error("Invalid stored creation request");
  const entry = JSON.parse(raw) as Partial<Journal> | null;
  if (!entry || !isProductionCreationRequest(entry.request)
      || (entry.transactionHash !== undefined && !isTransactionHash(entry.transactionHash))) throw new Error("Invalid stored creation request");
  return { request: entry.request, transactionHash: entry.transactionHash };
}

function writeJournal(entry: Journal) {
  localStorage.setItem(journalKey, JSON.stringify(entry));
}

class UnsupportedTreasury extends Error {}
class OwnerLoginRequired extends Error {}

async function post(body: object, csrf?: string) {
  if (!isProductionWalletOrigin(window.location)) throw new Error("Accepted HTTPS origin required");
  const response = await fetch(productionCreationPath, {
    method: "POST", headers: { "Content-Type": "application/json", ...(csrf && { "x-csrf-token": csrf }) }, body: JSON.stringify(body),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (response.status === 401 && payload.status === "owner-login-required") throw new OwnerLoginRequired();
  if (response.status === 422 && payload.status === "treasury-unsupported") throw new UnsupportedTreasury();
  if (!response.ok) throw new Error("Creation evidence unavailable");
  return payload;
}

async function prepare(draft: ReviewedLaunchDraft, account: string, factory: string, csrf: string, prior?: ProductionCreationRequest) {
  const { name, symbol, projectURI, treasury, treasuryShareBps } = draft;
  const fields: TestCreationFields = { name, symbol, projectURI, treasury, treasuryShareBps };
  const intentId = prior?.intentId ?? rmtCreationIntent;
  if (!isRmtCreation(fields, intentId)) throw new Error("Owner release requires the reviewed RMT terms");
  const payload = await post({ action: "prepare", account, fields, intentId, ...(prior && { prior }) }, csrf);
  const { request, payouts, gasEstimate } = payload;
  if (payload.status !== "prepared" || !isProductionCreationRequest(request) || !isTestCreationPayouts(payouts, !!treasury)
      || !same(payouts.operating, productionCreationOperating) || !same(payouts.reserve, productionCreationReserve)
      || [payouts.operating, payouts.reserve].some((recipient) => same(recipient, treasury)) || !same(request.from, account)
      || typeof gasEstimate !== "string" || !/^0x[1-9a-f][0-9a-f]{0,15}$/i.test(gasEstimate)
      || !same(request.to, factory) || !same(request.intentId, intentId) || !await productionCalldataMatches(request, fields)) {
    throw new Error("Review did not match the accepted deployment or draft fields");
  }
  return { request, payouts, gasEstimate };
}

async function verify(entry: Journal, inputHash?: string): Promise<TestCreationVerification> {
  const transactionHash = inputHash ?? entry.transactionHash;
  const payload = await post({ action: "verify", request: entry.request, ...(transactionHash && { transactionHash }) });
  const { status, token, indexed } = payload;
  const hash = payload.transactionHash;
  if ((status !== "pending" && status !== "confirmed" && status !== "reverted" && status !== "unavailable")
      || (hash !== undefined && (!isTransactionHash(hash) || (transactionHash && !same(hash, transactionHash))))
      || (status === "confirmed" && (!isLaunchAddress(token) || /^0x0{40}$/i.test(token) || typeof indexed !== "boolean" || !hash))
      || (status === "reverted" && !hash)) throw new Error("Unverified response");
  return {
    status, transactionHash: isTransactionHash(hash) ? hash : undefined,
    token: status === "confirmed" && isLaunchAddress(token) ? token as `0x${string}` : undefined,
    indexed: status === "confirmed" && indexed === true,
  };
}

export function ProductionCreationWallet({ factory, draft, isCurrentDraft, metadataSaved, onMetadataSaved }: {
  factory: string;
  metadataSaved: boolean;
  onMetadataSaved(draft: ReviewedLaunchDraft): void;
  draft?: ReviewedLaunchDraft;
  isCurrentDraft(draft: ReviewedLaunchDraft): boolean;
}) {
  const [ready, setReady] = useState(false);
  const [wallet, setWallet] = useState<Wallet>();
  const {session} = useAccount();
  const [journal, setJournal] = useState<Journal>();
  const [completed, setCompleted] = useState<CompletedProductionCreation[]>([]);
  const [result, setResult] = useState<TestCreationVerification>();
  const [message, setMessage] = useState("");

  const [recoveryHash, setRecoveryHash] = useState("");
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const selection = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    if (!isProductionWalletOrigin(window.location) || !navigator.locks) return;
    mounted.current = true;
    function restore() {
      try {
        setJournal(readJournal());
        setCompleted(readCompletedProductionCreations(localStorage));
        setReady(true);
      } catch {
        setReady(false);
        setMessage("The creation journal could not be read. Review is locked to protect the original request.");
      }
    }
    restore();
    const storageChanged = (event: StorageEvent) => {
      if (event.key !== journalKey && event.key !== completedProductionCreationsKey && event.key !== null) return;
      setResult(undefined);

      restore();
    };
    window.addEventListener("storage", storageChanged);
    const clearPreview = () => { selection.current++; };
    const onVisibility = () => { if (document.hidden) clearPreview(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", clearPreview);
    return () => {
      mounted.current = false;
      window.removeEventListener("storage", storageChanged);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", clearPreview);
    };
  }, []);

  useEffect(() => {
    if (!wallet) return;
    return subscribeTestWallet(wallet, () => {
      selection.current++;

      setWallet(undefined);

      setMessage("Wallet account or network changed. Connect and review again.");
    });
  }, [wallet]);

  async function withOperation(action: () => Promise<void>, onFailure: string) {
    if (!ready || operation.current) return;
    operation.current = true;
    setBusy(true);
    setMessage("");
    try { await action(); }
    catch (error) {
      if (error instanceof OwnerLoginRequired) {
        setMessage("Sign in again to review this creation.");
        return;
      }
      setMessage(error instanceof UnsupportedTreasury
        ? "This address is not a supported independent treasury in the accepted deployment. Choose a wallet you control or a verified Safe 1.4.1."
        : onFailure);
    }
    finally {
      setBusy(false);
      operation.current = false;
    }
  }

  async function launch() {
    if (!draft || !isCurrentDraft(draft) || !session.authenticated || !same(session.account.walletAddress,rmtCreationOwner)) throw new OwnerLoginRequired();
    if (!isRmtCreation(draft,rmtCreationIntent) || draft.treasury) throw new Error("Unapproved draft");
    const generation = selection.current;
    const bound = await connectProductionWallet();
    setWallet(bound);
    const receipt = descriptionMetadata(draft.description);
    if (receipt.projectURI !== draft.projectURI || receipt.artworkURL !== draft.artworkURL) throw new Error("Metadata changed");
    if (!metadataSaved) {
      if (!isCurrentDraft(draft) || generation !== selection.current) throw new Error("Draft changed");
      const response = await fetch("/api/artwork/upload", {method:"POST",redirect:"error",signal:AbortSignal.timeout(30000),
        headers:{"Content-Type":"application/json","x-csrf-token":session.csrfToken},body:JSON.stringify({description:draft.description,cid:receipt.cid})});
      if (!response.ok) throw new Error("Metadata unavailable");
      const saved = await response.json();
      if (saved.projectURI !== receipt.projectURI || saved.artworkURL !== receipt.artworkURL) throw new Error("Publication changed");
    }
    await verifyArtworkReceipt(receipt,AbortSignal.timeout(20000));
    if (!isCurrentDraft(draft) || generation !== selection.current) throw new Error("Draft changed");
    onMetadataSaved(draft);
    setMessage("Verifying the factory, fee and wallet nonce…");
    const prepared = await prepare(draft,bound.account,factory,session.csrfToken);
    await confirm({...prepared,draft,wallet:bound,factory},session.csrfToken,generation);
  }

  async function check(entry: Journal, manualHash?: string) {
    setResult(undefined);
    try {
      const next = await verify(entry, manualHash);
      // The server must bind the exact transaction envelope before a supplied hash is journaled.
      if (next.transactionHash && next.status !== "unavailable" && !same(entry.transactionHash, next.transactionHash)) {
        const updated = { request: entry.request, transactionHash: next.transactionHash };
        writeJournal(updated);
        setJournal(updated);
      }
      setResult(next);
    } catch { setResult({ status: "unavailable" }); }
  }

  async function confirm(prepared: Prepared, csrf: string, generation: number) {
    const { request, payouts, wallet: bound, draft: candidate } = prepared;
    await navigator.locks.request(productionAccountLock(bound.account), { mode: "exclusive", ifAvailable: true }, async accountLock => {
      if (!accountLock) throw new Error("Another financial transaction is in progress for this wallet");
      await navigator.locks.request(journalKey, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error("Another tab is sending");
      const existing = readJournal();
      if (existing) {
        setJournal(existing);
        throw new Error("Creation already recorded");
      }
      const current = await prepare(candidate, bound.account, factory, csrf, request);
      if (BigInt(current.gasEstimate) > BigInt(prepared.gasEstimate))
        throw new Error("Estimated creation gas increased. Review the updated estimate before continuing.");
      if (!sameProductionCreationRequest(request, current.request) || !same(payouts.operating, current.payouts.operating)
          || !same(payouts.reserve, current.payouts.reserve) || payouts.treasuryKind !== current.payouts.treasuryKind) {
        throw new Error("Factory or reviewed terms changed");
      }
      await assertProductionWallet(bound, request);
      if (!mounted.current || !isCurrentDraft(candidate) || selection.current !== generation || productionProviderAtWindow() !== bound.provider
          || bound.provider.request !== bound.request) throw new Error("Review changed");
      try {
        const submitted = await submitProductionCreation(bound, request, localStorage, () => {
          if (!mounted.current || !isCurrentDraft(candidate) || selection.current !== generation
              || productionProviderAtWindow() !== bound.provider || bound.provider.request !== bound.request) throw new Error("Review changed");
        });
        setJournal(submitted);
        if (submitted.transactionHash) {
          await check(submitted);
        } else {
          setMessage("The wallet did not return a hash. Check the original request before continuing.");
        }
      } catch (error) {
        if (testWalletErrorCode(error) === 4001) {
          localStorage.removeItem(journalKey);
          setJournal(undefined);
          setMessage("Request declined in your wallet.");
        } else {
          setJournal(readJournal());
          setMessage("The wallet result is uncertain. Check the original request before continuing.");
        }
      }
      });
    });
  }

  async function recover(manual = false) {
    const inputHash = recoveryHash.trim();
    if (manual && !isTransactionHash(inputHash)) {
      setMessage("Enter the 32-byte transaction hash from your wallet.");
      return;
    }
    await navigator.locks.request(journalKey, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error("Another tab is checking this request");
      const entry = readJournal();
      if (!entry) throw new Error("No request to recover");
      setJournal(entry);
      await check(entry, manual ? inputHash : undefined);
    });
  }

  async function continueFromCreation() {
    const original = readJournal(); if (!original) throw new Error("No original creation to verify");
    await navigator.locks.request(productionAccountLock(original.request.from), { mode: "exclusive", ifAvailable: true }, async accountLock => {
      if (!accountLock) throw new Error("Another financial request is in progress");
      await navigator.locks.request(journalKey, { mode: "exclusive", ifAvailable: true }, async journalLock => {
        if (!journalLock) throw new Error("Another tab is checking the original creation");
        const current = readJournal();
        if (!current || !sameProductionCreationRequest(current.request, original.request) || current.transactionHash !== original.transactionHash) throw new Error("Original creation selection changed");
        const verified = await verify(current);
        await withProductionNonceStore(localStorage, view => archiveCompletedProductionCreation(view, current, verified));
        setCompleted(readCompletedProductionCreations(localStorage)); setJournal(undefined); setResult(undefined);
        setMessage("Original creation receipt preserved. Trading and claims still require their separate approvals and wallet confirmations.");
      });
    });
  }

  const poll = useRef(() => Promise.resolve());
  poll.current = () => withOperation(() => recover(), "Checking the original creation again shortly.");
  const pendingReceipt = Boolean(journal && result?.status !== "reverted" && !result?.indexed);
  useEffect(() => {
    if (!ready || !pendingReceipt) return;
    const timer = window.setInterval(() => { if (!document.hidden) void poll.current(); },10000);
    return () => window.clearInterval(timer);
  },[ready,pendingReceipt]);

  if (!draft && !journal && !message && completed.length === 0) return null;
  const state = result?.status ?? "pending";
  return <section className="lpPanel lpForm" aria-label="Create on Robinhood Chain">
    <h2>Create on Robinhood Chain</h2>
    <p>Robinhood Chain 4663 Â· real ETH. Review the live network fee in MetaMask before personally confirming. The transaction includes the reviewed token name, ticker, project URI and treasury terms. The factory sets the one-billion-token supply. The registration includes the saved artwork metadata URI. The approved RMT metadata includes your published description.</p>
    {journal ? <>
      <p role="status">{state === "confirmed" ? "On-chain creation confirmed" : state === "reverted" ? "Creation reverted"
        : state === "unavailable" ? "Evidence unavailable" : "Transaction pending"}</p>
      {state === "confirmed" && <p>{result?.indexed ? "Indexed and verified" : "Indexing pending"}</p>}
      {state === "confirmed" && <p>Registration and the exact creation value are checked separately from complete settlement. Ethereum L1 finality remains unverified by this page. Creation never starts trading automatically.</p>}
      <dl className="lpFacts">
        <dt>Original creator</dt><dd className="lpAddress">{journal.request.from}</dd>
        <dt>Original factory</dt><dd className="lpAddress">{journal.request.to}</dd>
        <dt>Intent</dt><dd className="lpAddress">{journal.request.intentId}</dd>
        <dt>Transaction hash</dt><dd className="lpAddress">{journal.transactionHash ?? "Awaiting evidence"}</dd>
        {state === "confirmed" && result?.token && <><dt>Token contract</dt><dd className="lpAddress">{result.token}</dd></>}
      </dl>
      {state === "confirmed" && result?.token && <Link className="lpBack" href={`/launches/${result.token}`} prefetch={false}>Open token</Link>}
      <button type="button" className="lpButton lpSecondary" disabled={busy || !ready}
        onClick={() => void withOperation(() => recover(), "The original request is temporarily unavailable. Try again.")}>Check creation transaction</button>
      {(state === "confirmed" && result?.indexed === true || state === "reverted") && <button type="button" className="lpButton" disabled={busy || !ready}
        onClick={() => void withOperation(continueFromCreation, "Fresh canonical creation evidence or durable recovery storage is unavailable. The original request is retained.")}>Continue from verified creation</button>}
      {(!journal.transactionHash || state === "unavailable") && <>
        <label>Recover with transaction hash<input value={recoveryHash} onChange={(event) => setRecoveryHash(event.target.value)} autoComplete="off" maxLength={66} spellCheck={false} /></label>
        <button type="button" className="lpButton lpSecondary" disabled={busy || !ready}
          onClick={() => void withOperation(() => recover(true), "The hash could not be matched to the original request.")}>Recover transaction</button>
      </>}
    </> : draft && <>
      {!ready && <p>Wallet operations require the exact accepted origin and secure browser request locking.</p>}
      {session.authenticated && same(session.account.walletAddress,rmtCreationOwner) ? <>
        <p>Launch Token publishes the reviewed description and artwork if needed. Confirm creation once in MetaMask. The fee is 0.0004 ETH plus network gas.</p>
        <p>Confirmation uses two providers and 20 Robinhood Chain blocks. Ethereum settlement is unverified. A reorganization can reverse a receipt. Contract and governance risks remain after launch.</p>
        <button type="button" className="lpButton" disabled={busy || !ready} onClick={() => void withOperation(launch,"Launch paused. Check your owner wallet, network and saved draft, then try again.")}>{busy ? "Preparing launch…" : "Launch Token"}</button>
      </> : <Link href="/account/profile">Sign in with the owner wallet to launch</Link>}
    </>}
    {completed.length > 0 && <details className="lpRecovery"><summary>Preserved creation receipts ({completed.length})</summary><div className="lpForm">
      {completed.map(entry => <div key={entry.transactionHash}><code className="lpAddress">{entry.transactionHash}</code>
        <p>Original nonce {BigInt(entry.request.nonce).toString()} Â· {entry.verification.status} at the verified L2 checkpoint. L1 finality remains unverified.</p>
        {entry.verification.token && <Link className="lpBack" href={`/launches/${entry.verification.token}`} prefetch={false}>Open token</Link>}
        <button className="lpTextButton" type="button" disabled={busy || !ready} onClick={() => void withOperation(async () => {
          const checked = await verify(entry);
          setMessage(checked.status === "confirmed" && checked.indexed ? "The preserved creation is still canonical and indexed at the observed L2 checkpoint."
            : checked.status === "reverted" ? "The preserved creation still has a canonical reverted receipt."
            : "The preserved creation needs renewed canonical evidence. Its original request and consumed nonce remain protected.");
        }, "Preserved creation evidence is unavailable. The original request remains retained.")}>Check preserved creation</button>
      </div>)}
    </div></details>}
    {message && <p role="alert">{message}</p>}
  </section>;
}
