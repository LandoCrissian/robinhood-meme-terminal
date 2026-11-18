"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isLaunchAddress } from "../../lib/launch-data";
import { treasuryProjectPercent, type ReviewedLaunchDraft } from "../../lib/launch-draft";
import { launchTokenDecimals } from "../../lib/launch-terms";
import { calldataMatchesTestCreation, isLocalTestWallet, isTestCreationPayouts, isTestCreationRequest, isTransactionHash, sameTestCreationRequest,
  testCreationPath, type TestCreationFields, type TestCreationPayouts, type TestCreationRequest, type TestCreationVerification } from "../../lib/test-creation";
import { assertTestWalletBinding, connectTestWallet, sameWalletHex as same, subscribeTestWallet, testProviderAtWindow, testWalletErrorCode, type TestWallet as Wallet } from "../../lib/test-wallet";
import { assertNoUnresolvedFinancialRequests } from "./treasury-wallet-controls";

type Prepared = { draft: ReviewedLaunchDraft; wallet: Wallet; factory: string; request: TestCreationRequest; payouts: TestCreationPayouts };
type Journal = { request: TestCreationRequest; transactionHash?: `0x${string}` };

const journalKey = "rmt:creation-test:31337:v1";
function readJournal(): Journal | undefined {
  const raw = localStorage.getItem(journalKey);
  if (!raw) return;
  if (raw.length > 4096) throw new Error("Invalid stored creation request");
  const entry = JSON.parse(raw) as Partial<Journal> | null;
  if (!entry || !isTestCreationRequest(entry.request)
      || (entry.transactionHash !== undefined && !isTransactionHash(entry.transactionHash))) throw new Error("Invalid stored creation request");
  return { request: entry.request, transactionHash: entry.transactionHash };
}

function writeJournal(entry: Journal) {
  localStorage.setItem(journalKey, JSON.stringify(entry));
}

class UnsupportedTreasury extends Error {}

async function post(body: object) {
  if (!isLocalTestWallet(window.location)) throw new Error("Isolated test origin required");
  const response = await fetch(testCreationPath, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (response.status === 422 && payload.status === "treasury-unsupported") throw new UnsupportedTreasury();
  if (!response.ok) throw new Error("Test creation evidence unavailable");
  return payload;
}

async function prepare(draft: ReviewedLaunchDraft, account: string, factory: string, prior?: TestCreationRequest, treasuryIntentId?: `0x${string}`) {
  const { name, symbol, projectURI, treasury, treasuryShareBps } = draft;
  const fields: TestCreationFields = { name, symbol, projectURI, treasury, treasuryShareBps };
  if (treasuryIntentId && (!isTransactionHash(treasuryIntentId) || prior && !same(prior.intentId, treasuryIntentId))) throw Error("The treasury's original creation intent changed");
  const intentId = prior?.intentId ?? treasuryIntentId ?? "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const payload = await post({ action: "prepare", account, fields, intentId, ...(prior && { deadline: prior.deadline }) });
  const { request, payouts } = payload;
  if (payload.status !== "prepared" || !isTestCreationRequest(request) || !isTestCreationPayouts(payouts, !!treasury)
      || [payouts.operating, payouts.reserve].some((recipient) => same(recipient, treasury)) || !same(request.from, account)
      || !same(request.to, factory) || !same(request.intentId, intentId) || !await calldataMatchesTestCreation(request, fields)) {
    throw new Error("Review did not match the isolated deployment or draft fields");
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

export function TestCreationWallet({ factory, draft, isCurrentDraft, treasuryIntentId }: {
  factory: string;
  draft?: ReviewedLaunchDraft;
  isCurrentDraft(draft: ReviewedLaunchDraft): boolean;
  treasuryIntentId?: `0x${string}`;
}) {
  const [ready, setReady] = useState(false);
  const [wallet, setWallet] = useState<Wallet>();
  const [prepared, setPrepared] = useState<Prepared>();
  const [journal, setJournal] = useState<Journal>();
  const [result, setResult] = useState<TestCreationVerification>();
  const [message, setMessage] = useState("");
  const [treasuryAcknowledged, setTreasuryAcknowledged] = useState(false);
  const [recoveryHash, setRecoveryHash] = useState("");
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const selection = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    if (!isLocalTestWallet(window.location) || !navigator.locks) return;
    mounted.current = true;
    function restore() {
      try {
        setJournal(readJournal());
        setReady(true);
      } catch {
        setReady(false);
        setMessage("The test creation journal could not be read. Review is locked to protect the original request.");
      }
    }
    restore();
    const storageChanged = (event: StorageEvent) => {
      if (event.key !== journalKey && event.key !== null) return;
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
      setMessage("Test wallet account or network changed. Connect and review again.");
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
        ? "This address is not a supported independent treasury in the test deployment. Choose a wallet you control or a verified Safe 1.4.1."
        : onFailure);
    }
    finally {
      setBusy(false);
      operation.current = false;
    }
  }

  async function connect() {
    const connected = await connectTestWallet();
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
    const { request, payouts } = await prepare(draft, wallet.account, factory, undefined, treasuryIntentId);
    await assertTestWalletBinding(wallet, request);
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
        || (prepared.draft.treasury && !treasuryAcknowledged) || (treasuryIntentId && !same(prepared.request.intentId, treasuryIntentId))) return;
    const { request, payouts, wallet: bound, draft: candidate } = prepared;
    const generation = selection.current;
    setPrepared(undefined);
    await navigator.locks.request(`rmt.claim.execution.v1:31337:${bound.account.toLowerCase()}`, { mode: "exclusive", ifAvailable: true }, async payerLock => {
      if (!payerLock) throw Error("Another tab is handling this wallet's original transaction");
      await navigator.locks.request(journalKey, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error("Another tab is sending");
      const existing = readJournal();
      if (existing) {
        setJournal(existing);
        throw new Error("Creation already recorded");
      }
      assertNoUnresolvedFinancialRequests(bound.account);
      const current = await prepare(candidate, bound.account, factory, request, treasuryIntentId);
      if (!sameTestCreationRequest(request, current.request) || !same(payouts.operating, current.payouts.operating)
          || !same(payouts.reserve, current.payouts.reserve) || payouts.treasuryKind !== current.payouts.treasuryKind) {
        throw new Error("Factory or reviewed terms changed");
      }
      await assertTestWalletBinding(bound, request);
      if (!mounted.current || !isCurrentDraft(candidate) || selection.current !== generation || testProviderAtWindow() !== bound.provider
          || bound.provider.request !== bound.request) throw new Error("Review changed");
      let submitted: Journal = { request };
      assertNoUnresolvedFinancialRequests(bound.account);
      // Record before the wallet call, even when the provider returns no hash.
      writeJournal(submitted);
      setJournal(submitted);
      try {
        const { from, to, data, value, chainId } = request;
        const hash = await bound.request.call(bound.provider, { method: "eth_sendTransaction", params: [{ from, to, data, value, chainId }] });
        if (isTransactionHash(hash)) {
          submitted = { request, transactionHash: hash };
          writeJournal(submitted);
          setJournal(submitted);
          await check(submitted);
        } else {
          setMessage("The wallet did not return a hash. Check the original request before continuing.");
        }
      } catch (error) {
        if (testWalletErrorCode(error) === 4001) {
          localStorage.removeItem(journalKey);
          setJournal(undefined);
          setMessage("Request declined in your test wallet.");
        } else {
          setMessage("The wallet result is uncertain. Check the original request before continuing.");
        }
      }
      });
    });
  }

  async function recover(manual = false) {
    const inputHash = recoveryHash.trim();
    if (manual && !isTransactionHash(inputHash)) {
      setMessage("Enter the 32-byte transaction hash from your test wallet.");
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

  if (!draft && !journal && !message) return null;
  const currentReview = prepared && prepared.draft === draft && prepared.wallet === wallet && same(prepared.factory, factory)
    ? prepared : undefined;
  const state = result?.status ?? "pending";
  return <section className="lpPanel lpForm" aria-label="Isolated test creation">
    <h2>Isolated test creation</h2>
    <p>Local chain 31337 · synthetic ETH only. The transaction includes the reviewed token name, ticker, project URI and treasury terms. The factory sets the one-billion-token supply. Artwork and description stay in this browser.</p>
    {journal ? <>
      <p role="status">{state === "confirmed" ? "On-chain creation confirmed" : state === "reverted" ? "Creation reverted"
        : state === "unavailable" ? "Evidence unavailable" : "Transaction pending"}</p>
      {state === "confirmed" && <p>{result?.indexed ? "Indexed and verified" : "Indexing pending"}</p>}
      <dl className="lpFacts">
        <dt>Original creator</dt><dd className="lpAddress">{journal.request.from}</dd>
        <dt>Original factory</dt><dd className="lpAddress">{journal.request.to}</dd>
        <dt>Intent</dt><dd className="lpAddress">{journal.request.intentId}</dd>
        <dt>Transaction hash</dt><dd className="lpAddress">{journal.transactionHash ?? "Awaiting evidence"}</dd>
        {state === "confirmed" && result?.token && <><dt>Token contract</dt><dd className="lpAddress">{result.token}</dd></>}
      </dl>
      {state === "confirmed" && result?.token && <Link className="lpBack" href={`/launches/${result.token}`} prefetch={false}>Open test token</Link>}
      <button type="button" className="lpButton lpSecondary" disabled={busy || !ready}
        onClick={() => void withOperation(() => recover(), "The original request is temporarily unavailable. Try again.")}>Check creation transaction</button>
      {(!journal.transactionHash || state === "unavailable") && <>
        <label>Recover with transaction hash<input value={recoveryHash} onChange={(event) => setRecoveryHash(event.target.value)} autoComplete="off" maxLength={66} spellCheck={false} /></label>
        <button type="button" className="lpButton lpSecondary" disabled={busy || !ready}
          onClick={() => void withOperation(() => recover(true), "The hash could not be matched to the original request.")}>Recover transaction</button>
      </>}
    </> : draft && <>
      {!ready && <p>Test wallet operations require the exact local origin and secure browser request locking.</p>}
      {!wallet ? <button type="button" className="lpButton lpSecondary" disabled={busy || !ready}
        onClick={() => void withOperation(connect, "Connect an injected test wallet on chain 31337.")}>Connect test wallet</button>
        : currentReview ? <>
          <dl className="lpFacts">
            <dt>Creator</dt><dd className="lpAddress">{currentReview.request.from}</dd>
            <dt>Verified test factory</dt><dd className="lpAddress">{currentReview.request.to}</dd>
            <dt>Fixed total supply</dt><dd>{currentReview.draft.supply.toLocaleString("en-US")} tokens · {launchTokenDecimals} decimals</dd>
            <dt>Exact creation fee</dt><dd>0.0004 test ETH, plus gas</dd>
            <dt>RMT operations</dt><dd className="lpAddress">{currentReview.payouts.operating}</dd>
            <dt>RMT future reserve</dt><dd className="lpAddress">{currentReview.payouts.reserve}</dd>
            <dt>Project treasury</dt><dd className={currentReview.draft.treasury ? "lpAddress" : undefined}>{currentReview.draft.treasury || "None"}</dd>
            {currentReview.draft.treasury && <>
              <dt>Treasury share of project fees</dt><dd>{treasuryProjectPercent(currentReview.draft.treasuryShareBps)}</dd>
              <dt>Treasury compatibility</dt><dd>{currentReview.payouts.treasuryKind === "safe-1.4.1"
                ? "Verified Safe 1.4.1 configuration · submit claims through Safe"
                : currentReview.payouts.treasuryKind === "project-treasury-v1"
                ? "Verified per-project treasury contract · pinned treasury factory · controller-authorized claims"
                : "No contract code detected · verify control of this wallet"}</dd>
            </>}
          </dl>
          {currentReview.draft.treasury && <label className="lpTreasuryAcknowledge">
            <input type="checkbox" checked={treasuryAcknowledged} disabled={busy}
              onChange={(event) => setTreasuryAcknowledged(event.target.checked)} />
            I verified that the treasury controls this address and can submit fee claims.
          </label>}
          <button type="button" className="lpButton" disabled={busy || !ready || (!!currentReview.draft.treasury && !treasuryAcknowledged)}
            onClick={() => void withOperation(confirm, "The test wallet or reviewed terms changed. Review again.")}>Confirm test creation</button>
        </> : <button type="button" className="lpButton lpSecondary" disabled={busy || !ready}
          onClick={() => void withOperation(reviewCreation, "The test deployment or wallet could not be verified. Try review again.")}>Review test creation</button>}
    </>}
    {message && <p role="alert">{message}</p>}
  </section>;
}
