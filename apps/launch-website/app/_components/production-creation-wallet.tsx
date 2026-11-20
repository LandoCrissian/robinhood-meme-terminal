"use client";

import { productionAccountLock } from "../../lib/production-wallet";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isLaunchAddress } from "../../lib/launch-data";
import { treasuryProjectPercent, type ReviewedLaunchDraft } from "../../lib/launch-draft";
import { launchTokenDecimals } from "../../lib/launch-terms";
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

type Prepared = { draft: ReviewedLaunchDraft; wallet: Wallet; factory: string; request: ProductionCreationRequest; payouts: TestCreationPayouts };
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

async function post(body: object) {
  if (!isProductionWalletOrigin(window.location)) throw new Error("Accepted HTTPS origin required");
  const response = await fetch(productionCreationPath, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (response.status === 422 && payload.status === "treasury-unsupported") throw new UnsupportedTreasury();
  if (!response.ok) throw new Error("Creation evidence unavailable");
  return payload;
}

async function prepare(draft: ReviewedLaunchDraft, account: string, factory: string, prior?: ProductionCreationRequest) {
  const { name, symbol, projectURI, treasury, treasuryShareBps } = draft;
  const fields: TestCreationFields = { name, symbol, projectURI, treasury, treasuryShareBps };
  const intentId = prior?.intentId ?? "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const payload = await post({ action: "prepare", account, fields, intentId, ...(prior && { prior }) });
  const { request, payouts } = payload;
  if (payload.status !== "prepared" || !isProductionCreationRequest(request) || !isTestCreationPayouts(payouts, !!treasury)
      || !same(payouts.operating, productionCreationOperating) || !same(payouts.reserve, productionCreationReserve)
      || [payouts.operating, payouts.reserve].some((recipient) => same(recipient, treasury)) || !same(request.from, account)
      || !same(request.to, factory) || !same(request.intentId, intentId) || !await productionCalldataMatches(request, fields)) {
    throw new Error("Review did not match the accepted deployment or draft fields");
  }
  return { request, payouts };
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

export function ProductionCreationWallet({ factory, draft, isCurrentDraft }: {
  factory: string;
  draft?: ReviewedLaunchDraft;
  isCurrentDraft(draft: ReviewedLaunchDraft): boolean;
}) {
  const [ready, setReady] = useState(false);
  const [wallet, setWallet] = useState<Wallet>();
  const [prepared, setPrepared] = useState<Prepared>();
  const [journal, setJournal] = useState<Journal>();
  const [completed, setCompleted] = useState<CompletedProductionCreation[]>([]);
  const [result, setResult] = useState<TestCreationVerification>();
  const [message, setMessage] = useState("");
  const [treasuryAcknowledged, setTreasuryAcknowledged] = useState(false);
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
      setPrepared(undefined);
      restore();
    };
    window.addEventListener("storage", storageChanged);
    return () => {
      mounted.current = false;
      window.removeEventListener("storage", storageChanged);
    };
  }, []);

  useEffect(() => {
    if (!wallet) return;
    return subscribeTestWallet(wallet, () => {
      selection.current++;
      setPrepared(undefined);
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
      setMessage(error instanceof UnsupportedTreasury
        ? "This address is not a supported independent treasury in the accepted deployment. Choose a wallet you control or a verified Safe 1.4.1."
        : onFailure);
    }
    finally {
      setBusy(false);
      operation.current = false;
    }
  }

  async function connect() {
    const connected = await connectProductionWallet();
    selection.current++;
    setWallet(connected);
    setPrepared(undefined);
  }

  async function reviewCreation() {
    if (!wallet || !draft) return;
    setPrepared(undefined);
    setTreasuryAcknowledged(false);
    const generation = selection.current;
    if (draft.treasury && same(draft.treasury, wallet.account)) {
      setMessage("Choose a project treasury address different from the creator.");
      return;
    }
    const { request, payouts } = await prepare(draft, wallet.account, factory);
    await assertProductionWallet(wallet, request);
    if (!isCurrentDraft(draft) || selection.current !== generation) throw new Error("Review changed");
    setPrepared({ draft, wallet, factory, request, payouts });
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

  async function confirm() {
    if (!prepared || !isCurrentDraft(prepared.draft) || !same(prepared.factory, factory)
        || (prepared.draft.treasury && !treasuryAcknowledged)) return;
    const { request, payouts, wallet: bound, draft: candidate } = prepared;
    const generation = selection.current;
    setPrepared(undefined);
    await navigator.locks.request(productionAccountLock(bound.account), { mode: "exclusive", ifAvailable: true }, async accountLock => {
      if (!accountLock) throw new Error("Another financial transaction is in progress for this wallet");
      await navigator.locks.request(journalKey, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error("Another tab is sending");
      const existing = readJournal();
      if (existing) {
        setJournal(existing);
        throw new Error("Creation already recorded");
      }
      const current = await prepare(candidate, bound.account, factory, request);
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
        archiveCompletedProductionCreation(localStorage, current, verified);
        setCompleted(readCompletedProductionCreations(localStorage)); setJournal(undefined); setResult(undefined); setPrepared(undefined);
        setMessage("Original creation receipt preserved. Trading and claims still require their separate approvals and wallet confirmations.");
      });
    });
  }

  if (!draft && !journal && !message && completed.length === 0) return null;
  const currentReview = prepared && prepared.draft === draft && prepared.wallet === wallet && same(prepared.factory, factory)
    ? prepared : undefined;
  const state = result?.status ?? "pending";
  return <section className="lpPanel lpForm" aria-label="Create on Robinhood Chain">
    <h2>Create on Robinhood Chain</h2>
    <p>Robinhood Chain 4663 · real ETH. Review the live network fee in MetaMask before personally confirming. The transaction includes the reviewed token name, ticker, project URI and treasury terms. The factory sets the one-billion-token supply. Artwork and description stay in this browser.</p>
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
      {!wallet ? <button type="button" className="lpButton lpSecondary" disabled={busy || !ready}
        onClick={() => void withOperation(connect, "Connect an injected wallet on Robinhood Chain 4663.")}>Connect wallet</button>
        : currentReview ? <>
          <dl className="lpFacts">
            <dt>Creator</dt><dd className="lpAddress">{currentReview.request.from}</dd>
            <dt>Verified factory</dt><dd className="lpAddress">{currentReview.request.to}</dd>
            <dt>Fixed total supply</dt><dd>{currentReview.draft.supply.toLocaleString("en-US")} tokens · {launchTokenDecimals} decimals</dd>
            <dt>Exact creation fee</dt><dd>0.0004 ETH, plus gas</dd>
            <dt>RMT operations</dt><dd className="lpAddress">{currentReview.payouts.operating}</dd>
            <dt>RMT future reserve</dt><dd className="lpAddress">{currentReview.payouts.reserve}</dd>
            <dt>Project treasury</dt><dd className={currentReview.draft.treasury ? "lpAddress" : undefined}>{currentReview.draft.treasury || "None"}</dd>
            {currentReview.draft.treasury && <>
              <dt>Treasury share of project fees</dt><dd>{treasuryProjectPercent(currentReview.draft.treasuryShareBps)}</dd>
              <dt>Treasury compatibility</dt><dd>{currentReview.payouts.treasuryKind === "safe-1.4.1"
                ? "Verified Safe 1.4.1 configuration · submit claims through Safe"
                : "No contract code detected · verify control of this wallet"}</dd>
            </>}
          </dl>
          {currentReview.draft.treasury && <label className="lpTreasuryAcknowledge">
            <input type="checkbox" checked={treasuryAcknowledged} disabled={busy}
              onChange={(event) => setTreasuryAcknowledged(event.target.checked)} />
            I verified that the treasury controls this address and can submit fee claims.
          </label>}
          <button type="button" className="lpButton" disabled={busy || !ready || (!!currentReview.draft.treasury && !treasuryAcknowledged)}
            onClick={() => void withOperation(confirm, "The wallet or reviewed terms changed. Review again.")}>Confirm creation</button>
        </> : <button type="button" className="lpButton lpSecondary" disabled={busy || !ready}
          onClick={() => void withOperation(reviewCreation, "The accepted deployment or wallet could not be verified. Try review again.")}>Review creation</button>}
    </>}
    {completed.length > 0 && <details className="lpRecovery"><summary>Preserved creation receipts ({completed.length})</summary><div className="lpForm">
      {completed.map(entry => <div key={entry.transactionHash}><code className="lpAddress">{entry.transactionHash}</code>
        <p>Original nonce {BigInt(entry.request.nonce).toString()} · {entry.verification.status} at the verified L2 checkpoint. L1 finality remains unverified.</p>
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
