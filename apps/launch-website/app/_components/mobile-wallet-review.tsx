"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatEther, keccak256 } from "viem";
import { isMobileAddress, isMobileReview, mobileReviewApi, mobileTestFields, type MobilePlan, type MobileReview } from "../../lib/mobile-wallet-review";
import { launchTerms } from "../../lib/launch-terms";
import { calldataMatchesTestCreation, isLocalTestWallet, isTransactionHash, sameTestCreationRequest } from "../../lib/test-creation";
import { assertTestWalletBinding, connectTestWallet, sameWalletHex as same, subscribeTestWallet,
  testProviderAtWindow, testWalletErrorCode, type TestWallet } from "../../lib/test-wallet";

type Hex = `0x${string}`;
type Journal = { review: MobileReview; transactionHash?: Hex; returnedHash?: Hex };

const journalKey = "rmt:mobile-review:31337:v1";
const lockKey = "rmt:creation-test:31337:v1";
const statuses = {
  disconnected: "Connect the fixture wallet to prepare a synthetic transaction.",
  connecting: "Waiting for wallet connection.",
  connected: "Synthetic wallet connected. Prepare the transaction for review.",
  unsupported: "This browser needs an injected EVM wallet and local transaction locking.",
  wrongWallet: "Select the authorized synthetic account on chain 31337. Reconnect to try again.",
  preparing: "Checking the pinned fixture, nonce, value and gas estimate.",
  ready: "Review the amount, destination and maximum gas before continuing.",
  stale: "The wallet, nonce, quote or canonical block changed. Prepare a fresh review.",
  signing: "Review the synthetic transaction in the wallet.",
  rejected: "Wallet request rejected. You can prepare a new review.",
  pending: "Transaction evidence is pending. Check the original submission to recover it.",
  mismatch: "This hash did not match the reviewed synthetic transaction. The original submission is still open.",
  unavailable: "Transaction evidence is unavailable. Check the original submission again.",
  preparationFailed: "Preparation failed. Check the pinned local fixture and synthetic balance.",
  journalFailed: "The recovery journal could not be saved or read. Resolve browser storage before continuing.",
  reverted: "The matching synthetic transaction reverted on chain 31337.",
  confirmed: "The matching synthetic creation receipt is verified on chain 31337.",
};

type Phase = keyof typeof statuses;

function readJournal(): Journal | undefined {
  const raw = localStorage.getItem(journalKey);
  if (!raw) return;
  if (raw.length > 4096) throw new Error("Invalid mobile recovery record");
  const stored = JSON.parse(raw) as Partial<Journal> | null;
  if (!stored || !isMobileReview(stored.review) ||
      (stored.transactionHash !== undefined && !isTransactionHash(stored.transactionHash)) ||
      (stored.returnedHash !== undefined && !isTransactionHash(stored.returnedHash))) throw new Error("Invalid mobile recovery record");
  return { review: stored.review, transactionHash: stored.transactionHash, returnedHash: stored.returnedHash };
}

function saveJournal(entry: Journal) {
  localStorage.setItem(journalKey, JSON.stringify(entry));
}

async function post(body: object) {
  if (!isLocalTestWallet(window.location)) throw new Error("Local fixture required");
  const response = await fetch(mobileReviewApi, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Fixture evidence unavailable");
  return await response.json() as Record<string, unknown>;
}

async function isBoundReview(value: unknown, wallet: TestWallet, factory: string, intentId: string) {
  return isMobileReview(value) && same(value.request.from, wallet.account) && same(value.request.to, factory)
    && same(value.request.intentId, intentId) && same(keccak256(value.request.data), value.calldataHash)
    && await calldataMatchesTestCreation(value.request, mobileTestFields);
}

function anchors({ request, reviewBlockNumber, reviewBlockHash }: MobileReview) {
  return { blockNumber: request.blockNumber, blockHash: request.blockHash, reviewBlockNumber, reviewBlockHash };
}

function sameReview(first: MobileReview, next: MobileReview) {
  return sameTestCreationRequest(first.request, next.request)
    && same(first.expectedToken, next.expectedToken) && same(first.expectedCurve, next.expectedCurve)
    && same(first.payouts.operating, next.payouts.operating) && same(first.payouts.reserve, next.payouts.reserve)
    && first.nonce === next.nonce && first.gas === next.gas && first.gasPrice === next.gasPrice;
}

function ReviewFacts({ review }: { review: MobileReview }) {
  const { request } = review;
  return <section className="lpPanel lpForm" aria-label="Synthetic transaction details" data-testid="mobile-fields">
    <h2>Review synthetic creation</h2>
    <dl className="lpFacts">
      <div><dt>Network</dt><dd>Anvil 31337</dd></div>
      <div><dt>Action</dt><dd>Factory create · {mobileTestFields.name} ({mobileTestFields.symbol})</dd></div>
      <div><dt>Sender</dt><dd className="lpAddress">{request.from}</dd></div>
      <div><dt>Destination</dt><dd className="lpAddress">{request.to}</dd></div>
      <div><dt>Value</dt><dd>{formatEther(BigInt(request.value))} synthetic ETH</dd></div>
      <div><dt>Nonce</dt><dd>{BigInt(review.nonce).toString()}</dd></div>
      <div><dt>Gas limit</dt><dd>{BigInt(review.gas).toString()} gas</dd></div>
      <div><dt>Gas price</dt><dd>{BigInt(review.gasPrice).toString()} wei per gas</dd></div>
      <div><dt>Maximum L2 fee</dt><dd>{formatEther(BigInt(review.estimatedL2Wei))} synthetic ETH</dd></div>
      <div><dt>L1 data fee</dt><dd>0 synthetic ETH · local Anvil only</dd></div>
      <div><dt>Estimate evidence</dt><dd className="lpAddress">Block {BigInt(review.reviewBlockNumber).toString()} · {review.reviewBlockHash}</dd></div>
      <div><dt>Review expires</dt><dd>{new Date(review.expiresAt).toISOString()}</dd></div>
      <div><dt>Contract deadline</dt><dd>{request.deadline} Unix seconds (fixture clock)</dd></div>
      <div><dt>Calldata hash</dt><dd className="lpAddress">{review.calldataHash}</dd></div>
      <div><dt>Predicted token</dt><dd className="lpAddress">{review.expectedToken}</dd></div>
      <div><dt>Predicted curve</dt><dd className="lpAddress">{review.expectedCurve}</dd></div>
      <div><dt>Project URI</dt><dd className="lpAddress">{mobileTestFields.projectURI}</dd></div>
      <div><dt>Fixed launch supply</dt><dd>1,000,000,000 tokens · 18 decimals</dd></div>
      <div><dt>Supply allocation</dt><dd>{launchTerms.curveAllocationPercent}% curve · {launchTerms.liquidityAllocationPercent}% locked liquidity after graduation</dd></div>
      <div><dt>Backing at creation</dt><dd>0 ETH · graduation requires {launchTerms.graduationBackingEth} synthetic ETH</dd></div>
      <div><dt>Creator/project</dt><dd>{launchTerms.projectFeeSharePercent}% of curve fees · creator only for this fixture</dd></div>
      <div><dt>Operating recipient</dt><dd className="lpAddress">{review.payouts.operating} · creation fee and {launchTerms.operatingFeeSharePercent}% of curve fees</dd></div>
      <div><dt>Reserve recipient</dt><dd className="lpAddress">{review.payouts.reserve} · {launchTerms.futureReserveFeeSharePercent}% of curve fees</dd></div>
      <div><dt>Curve trading fee</dt><dd>{launchTerms.curveTradeFeePercent}%</dd></div>
    </dl>
  </section>;
}

function OfflinePlan({ plan, proposedSender }: { plan: MobilePlan | null; proposedSender: string }) {
  const last = plan?.observation;
  const costs = new Map(last?.safes.map((safe) => [safe.address.toLowerCase(), safe]));
  const rowLabel = (id: string) => plan?.rows.find((row) => row.id === id)?.label ?? id;
  return <section className="lpPanel lpForm">
    <h2>Robinhood Chain 4663 · unsigned review</h2>
    <p className="lpAddress">Proposed sender {proposedSender}</p>
    <p>BLOCKED_NO_BROADCAST. A live transaction requires a fully bound release plan. Fork gas units below are rehearsal measurements.</p>
    {last && <dl className="lpFacts" data-testid="mobile-observed-sender">
      <div><dt>Archived account observation</dt><dd>{last.observedAt}</dd></div>
      <div><dt>Observed confirmed and pending nonces</dt><dd>{last.confirmedNonce} / {last.pendingNonce} · unbound to any transaction</dd></div>
      <div><dt>Observed account type</dt><dd>{last.accountType === "EIP_7702_DELEGATION"
        ? "EIP-7702 delegated account · ineligible for this deployment plan" : last.accountType === "CODE_EMPTY" ? "No contract code observed" : "Contract code observed"}</dd></div>
      <div><dt>Observation block</dt><dd className="lpAddress">{last.blockNumber} · {last.blockHash}</dd></div>
      <div><dt>Archive estimate validity ended</dt><dd>{last.expiresAt} · refresh required before any approval</dd></div>
    </dl>}
    {plan ? <div className="lpStack" data-testid="mobile-offline-plan">
      {plan.rows.map((row) => {
        const cost = row.expectedAddress && costs.get(row.expectedAddress.toLowerCase());
        return <details key={row.id}>
        <summary>{row.label}</summary>
        <dl className="lpFacts">
          <div><dt>Evidence type</dt><dd>{row.safe ? "Undeployed Safe proposal" : "Isolated 4663 fork rehearsal"}</dd></div>
          <div><dt>Authorization</dt><dd>{row.authorization.toLowerCase().replaceAll("_", " ")}</dd></div>
          {row.dependencies.length > 0 && <div><dt>Requires</dt><dd>{row.dependencies.map(rowLabel).join(" · ")}</dd></div>}
          <div><dt>Sender</dt><dd className="lpAddress">{row.from ?? "Unassigned"}</dd></div>
          <div><dt>Destination</dt><dd className="lpAddress">{row.to ?? "Contract creation"}</dd></div>
          <div><dt>Value</dt><dd>{formatEther(BigInt(row.valueWei))} ETH</dd></div>
          <div><dt>Nonce</dt><dd>{row.nonce ?? "Unavailable"}</dd></div>
          <div><dt>Calldata hash</dt><dd className="lpAddress">{row.dataHash ?? "Unavailable"}</dd></div>
          <div><dt>Expected contract</dt><dd className="lpAddress">{row.expectedAddress ?? "Not applicable"}</dd></div>
          <div><dt>Observed fork gas</dt><dd>{row.observedForkGas ?? "Unavailable"}</dd></div>
          {row.receiptHash && <div><dt>Fixture receipt</dt><dd className="lpAddress">{row.receiptHash}</dd></div>}
          {row.receiptBlock && <div><dt>Fixture block</dt><dd className="lpAddress">{row.receiptBlock.number} · {row.receiptBlock.hash}</dd></div>}
          {row.safe && <>
            <div><dt>Safe profile</dt><dd>SafeL2 1.4.1 · 2 of 3 owners</dd></div>
            <div><dt>Owners</dt><dd className="lpAddress">{row.safe.owners.map((owner) => <div key={owner}>{owner}</div>)}</dd></div>
            <div><dt>Proposed salt</dt><dd className="lpAddress">{row.safe.saltNonce}</dd></div>
          </>}
          {cost && <>
            <div><dt>Archived L2 estimate</dt><dd>{formatEther(BigInt(cost.l2Wei))} ETH</dd></div>
            <div><dt>Archived L1 poster estimate</dt><dd>{formatEther(BigInt(cost.l1Wei))} ETH</dd></div>
            <div><dt>Archived total estimate</dt><dd>{formatEther(BigInt(cost.totalWei))} ETH</dd></div>
          </>}
        </dl>
      </details>;
      })}
    </div> : <p>Offline plan evidence is unavailable in this rehearsal.</p>}
  </section>;
}

export function MobileWalletReview({ account, factory, plan, proposedSender }: {
  account: string; factory: string; plan: MobilePlan | null; proposedSender: string;
}) {
  const [wallet, setWallet] = useState<TestWallet>();
  const [review, setReview] = useState<MobileReview>();
  const [approved, setApproved] = useState(false);
  const [entry, setEntry] = useState<Journal>();
  const [hashInput, setHashInput] = useState("");
  const [token, setToken] = useState<Hex>();
  const [indexed, setIndexed] = useState(false);
  const [phase, setPhase] = useState<Phase>("disconnected");
  const generation = useRef(0);
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [storageUsable, setStorageUsable] = useState(false);

  function resetReview() {
    setReview(undefined);
    setApproved(false);
  }

  useEffect(() => {
    if (!isLocalTestWallet(window.location) || !navigator.locks) {
      setPhase("unsupported");
      return;
    }
    function load() {
      try {
        const existing = readJournal();
        setEntry(existing);
        setStorageUsable(true);
        setPhase(existing ? "pending" : "disconnected");
      } catch {
        setStorageUsable(false);
        setPhase("journalFailed");
      }
    }
    function sync(event: StorageEvent) {
      if (event.key === journalKey || event.key === null) {
        generation.current += 1;
        setReview(undefined);
        setApproved(false);
        load();
      }
    }
    load();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  useEffect(() => wallet && subscribeTestWallet(wallet, () => {
    generation.current += 1;
    setWallet(undefined);
    setReview(undefined);
    setApproved(false);
    setPhase((prior) => prior === "signing" || prior === "pending" || prior === "confirmed" || prior === "reverted" ? prior : "wrongWallet");
  }), [wallet]);

  async function run(task: () => Promise<unknown>) {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    try {
      await task();
    } catch {
      setPhase("unavailable");
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  function connect() {
    void run(async () => {
      resetReview();
      setWallet(undefined);
      if (!testProviderAtWindow()) {
        setPhase("unsupported");
        return;
      }
      setPhase("connecting");
      try {
        const provider = testProviderAtWindow();
        const [activeChain, activeAccounts] = await Promise.all([
          provider?.request({ method: "eth_chainId" }), provider?.request({ method: "eth_accounts" }),
        ]);
        if (!provider || activeChain !== "0x7a69" || !Array.isArray(activeAccounts)
            || (activeAccounts.length > 0 && !same(activeAccounts[0], account))) {
          setPhase("wrongWallet");
          return;
        }
        const selected = await connectTestWallet();
        if (!same(selected.account, account)) {
          setPhase("wrongWallet");
          return;
        }
        setWallet(selected);
        setPhase("connected");
      } catch (error) {
        setPhase(testWalletErrorCode(error) === 4001 ? "rejected" : "wrongWallet");
      }
    });
  }

  function prepare() {
    if (!wallet) return;
    void run(async () => {
      resetReview();
      const boundary = generation.current;
      const intentId = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      setPhase("preparing");
      try {
        await assertTestWalletBinding(wallet);
        const payload = await post({ action: "prepare", account: wallet.account, intentId });
        const next = payload.review;
        if (payload.status !== "prepared" || !isMobileReview(next) || !await isBoundReview(next, wallet, factory, intentId)) {
          setPhase("preparationFailed");
          return;
        }
        await assertTestWalletBinding(wallet, anchors(next));
        if (boundary !== generation.current || readJournal()) {
          setPhase("stale");
          return;
        }
        setReview(next);
        setPhase("ready");
      } catch {
        setPhase("preparationFailed");
      }
    });
  }

  async function checkReceipt(current: Journal, transactionHash = current.transactionHash) {
    setToken(undefined);
    setIndexed(false);
    let payload: Record<string, unknown>;
    try {
      payload = await post({ action: "verify", review: current.review, ...(transactionHash && { transactionHash }) });
    } catch {
      setPhase("unavailable");
      return;
    }
    if (payload.status === "mismatch" && !current.transactionHash && transactionHash
        && current.returnedHash && same(transactionHash, current.returnedHash)) {
      // Discard only a wallet-returned candidate conclusively unrelated to the reviewed intent.
      // Keep the journal, so the next check searches for the original creation.
      const original = { review: current.review };
      saveJournal(original);
      setEntry(original);
    }
    if (payload.status === "mismatch" || (payload.transactionHash !== undefined &&
        (!isTransactionHash(payload.transactionHash) || (transactionHash && !same(payload.transactionHash, transactionHash))))) {
      setPhase("mismatch");
      return;
    }
    const hash = payload.transactionHash;
    if (payload.status === "unavailable") {
      setPhase("unavailable");
      return;
    }
    if (payload.status === "pending" || payload.status === "reverted" || payload.status === "confirmed") {
      const confirmed = payload.status === "confirmed";
      if ((payload.status !== "pending" && !isTransactionHash(hash))
          || (confirmed && (!isMobileAddress(payload.token) || !same(payload.token, current.review.expectedToken) || !isMobileAddress(payload.curve) || !same(payload.curve, current.review.expectedCurve) || typeof payload.indexed !== "boolean"))) {
        setPhase("mismatch");
        return;
      }
      if (isTransactionHash(hash)) {
        const updated = { review: current.review, transactionHash: hash };
        saveJournal(updated);
        setEntry(updated);
      }
      setHashInput("");
      setToken(confirmed ? current.review.expectedToken : undefined);
      setIndexed(confirmed && payload.indexed === true);
      setPhase(payload.status);
      return;
    }
    setPhase("unavailable");
  }

  function submit() {
    if (!wallet || !review || !approved || !navigator.locks) return;
    void run(() => navigator.locks.request(lockKey, { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      const existing = readJournal();
      if (existing) {
        resetReview();
        setEntry(existing);
        setPhase("pending");
        return;
      }
      const boundary = generation.current;
      let next: MobileReview;
      try {
        if (Date.now() >= review.expiresAt) throw new Error("Expired review");
        const payload = await post({ action: "refresh", review });
        const candidate = payload.review;
        if (payload.status !== "prepared" || !isMobileReview(candidate) ||
            !await isBoundReview(candidate, wallet, factory, review.request.intentId) || !sameReview(review, candidate)) {
          throw new Error("Review changed");
        }
        next = candidate;
        await assertTestWalletBinding(wallet, anchors(next));
        const nonce = await wallet.request.call(wallet.provider, {
          method: "eth_getTransactionCount", params: [next.request.from, "pending"],
        });
        if (!same(nonce, next.nonce) || boundary !== generation.current ||
            Date.now() >= review.expiresAt || testProviderAtWindow() !== wallet.provider || wallet.provider.request !== wallet.request) {
          throw new Error("Wallet changed");
        }
      } catch {
        resetReview();
        setPhase("stale");
        return;
      }

      const submitted: Journal = { review: next };
      try {
        saveJournal(submitted);
      } catch {
        setPhase("journalFailed");
        return;
      }
      setEntry(submitted);
      resetReview();
      setPhase("signing");
      let hash: unknown;
      try {
        const { from, to, data, value, chainId } = next.request;
        hash = await wallet.request.call(wallet.provider, { method: "eth_sendTransaction",
          params: [{ from, to, data, value, chainId, nonce: next.nonce, gas: next.gas, gasPrice: next.gasPrice }],
        });
      } catch (error) {
        if (testWalletErrorCode(error) === 4001) {
          localStorage.removeItem(journalKey);
          setEntry(undefined);
          setPhase("rejected");
          return;
        }
      }
      if (isTransactionHash(hash)) {
        submitted.returnedHash = hash;
        saveJournal(submitted);
        setEntry({ ...submitted });
      }
      setPhase("pending");
      await checkReceipt(submitted, submitted.returnedHash);
    }));
  }

  function recover(useInput: boolean) {
    if (!navigator.locks || (useInput && !isTransactionHash(hashInput.trim()))) return;
    void run(() => navigator.locks.request(lockKey, { ifAvailable: true }, async (lock) => {
      const original = lock && readJournal();
      if (original) await checkReceipt(original, useInput ? hashInput.trim() as Hex : original.transactionHash ?? original.returnedHash);
    }));
  }

  function clear() {
    if (!navigator.locks || (phase !== "confirmed" && phase !== "reverted")) return;
    void run(() => navigator.locks.request(lockKey, { ifAvailable: true }, async (lock) => {
      const original = lock && readJournal();
      if (!original || !entry || !original.transactionHash || !same(original.transactionHash, entry.transactionHash ?? "")) return;
      localStorage.removeItem(journalKey);
      setEntry(undefined);
      setToken(undefined);
      setIndexed(false);
      setPhase(wallet ? "connected" : "disconnected");
    }));
  }

  return <div className="lpStack">
    <section className="lpPanel lpForm" aria-label="Synthetic wallet rehearsal">
      <h2>Local wallet rehearsal · chain 31337</h2>
      <p>Use an injected EVM wallet with the authorized test account on the local Anvil network. All transactions use synthetic ETH.</p>
      <p className="lpNotice" role="status" data-testid="mobile-status" data-phase={phase}>{statuses[phase]}</p>
      {storageUsable && !entry && <div className="lpStack">
        <button className="lpButton lpSecondary" data-testid="mobile-connect" disabled={working} onClick={connect}>{wallet ? "Reconnect test wallet" : "Connect test wallet"}</button>
        {wallet && <button className="lpButton lpSecondary" data-testid="mobile-prepare" disabled={working} onClick={prepare}>Prepare synthetic creation</button>}
      </div>}
      {entry && <div className="lpStack">
        <p>Original review and intent are saved on this device. Recovery checks existing chain evidence.</p>
        {entry.transactionHash && <p className="lpAddress" data-testid="mobile-transaction-hash">{entry.transactionHash}</p>}
        {!entry.transactionHash && entry.returnedHash && <p className="lpAddress">Wallet returned {entry.returnedHash} · receipt unverified</p>}
        <button className="lpButton lpSecondary" data-testid="mobile-check" disabled={working} onClick={() => recover(false)}>Check original transaction</button>
        <label htmlFor="mobile-original-hash">Original transaction hash (optional)</label>
        <input id="mobile-original-hash" data-testid="mobile-recovery-hash" value={hashInput} onChange={(event) => setHashInput(event.currentTarget.value)}
          maxLength={66} autoComplete="off" autoCapitalize="off" spellCheck={false} />
        <button className="lpButton lpSecondary" data-testid="mobile-recover" disabled={working || !isTransactionHash(hashInput.trim())} onClick={() => recover(true)}>Verify this hash</button>
        {token && <p>Verified token <span className="lpAddress">{token}</span>{indexed
          ? <> · <Link href={"/launches/" + token} prefetch={false}>View indexed launch</Link></>
          : " · indexing pending"}</p>}
        {(phase === "reverted" || phase === "confirmed") && <button className="lpButton lpSecondary" data-testid="mobile-clear" disabled={working} onClick={clear}>Clear local rehearsal record</button>}
      </div>}
    </section>
    {(review || entry) && <ReviewFacts review={(review ?? entry?.review)!} />}
    {review && !entry && <section className="lpPanel lpForm">
      <label>
        <input type="checkbox" data-testid="mobile-approve" checked={approved} disabled={working}
          onChange={(event) => setApproved(event.currentTarget.checked)} />
        {" "}I reviewed the account, factory, amount, nonce and gas for this synthetic creation.
      </label>
      <button className="lpButton" data-testid="mobile-submit" disabled={working || !approved} onClick={submit}>Review in test wallet</button>
    </section>}
    <OfflinePlan plan={plan} proposedSender={proposedSender} />
  </div>;
}
