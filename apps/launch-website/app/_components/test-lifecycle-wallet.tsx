"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FixtureLifecycle } from "../../lib/server/fixture-discovery";
import { isLocalTestWallet, isTransactionHash } from "../../lib/test-creation";
import { isLifecycleAmount, isLifecycleSlippage, isTestLifecycleRequest, lifecycleCalldataMatches, sameLifecycleValue as same,
  sameTestLifecycleRequest, testLifecyclePath, type TestLifecycleOperation, type TestLifecycleQuote, type TestLifecycleRequest,
  type TestLifecycleState, type TestLifecycleVerification } from "../../lib/test-lifecycle";
import { archiveTestTrade, readTestTradeJournal, testTradeJournalKey, writeTestTradeJournal,
  type TestTradeJournal, type TestTradeJournalEntry } from "../../lib/test-trade-journal";
import { assertTestWalletBinding, connectTestWallet, subscribeTestWallet, testProviderAtWindow,
  sameWalletHex, testWalletErrorCode, type TestWallet } from "../../lib/test-wallet";
import { formatTestAmount, formatTestPercent } from "./fixture-lifecycle-evidence";

type Binding = { factory: string; token: string; blockNumber: string; blockHash: string };
type Prepared = { request: TestLifecycleRequest; quote: TestLifecycleQuote; wallet: TestWallet; formRevision: number };

const operationLabel = { buy: "test buy", sell: "test sell", approve: "exact test approval", graduate: "test graduation" };
const reasons: Record<string, string> = {
  "insufficient-allowance": "Review and grant the exact allowance before selling.",
  "insufficient-balance": "The selected wallet does not have enough test assets.",
  "stale-review": "The selected wallet or reviewed quote changed. Review the new terms.",
  "curve-closed": "This curve does not accept the selected trade.",
  "graduation-not-ready": "The curve has not reached both graduation thresholds.",
  "amount-unavailable": "A quote is unavailable for this amount.",
  "wallet-pending": "A wallet transaction is pending. Recover it before making another request.",
};

const uint = (value: unknown): value is string =>
  typeof value === "string" && /^(?:0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;

function parseTradeAmount(input: string) {
  if (!/^\d{1,12}(?:\.\d{1,18})?$/.test(input)) throw new Error("Enter a positive amount with up to 18 decimal places.");
  const [whole, fraction = ""] = input.split(".");
  return (BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"))).toString();
}

function parseSlippage(input: string) {
  if (!/^\d(?:\.\d{1,2})?$/.test(input)) throw new Error("Enter slippage from 0% through 5%, with up to two decimal places.");
  const [whole, fraction = ""] = input.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

async function lifecyclePost(body: object, signal?: AbortSignal) {
  if (!isLocalTestWallet(window.location)) throw new Error("Isolated test origin required.");
  const response = await fetch(testLifecyclePath, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    cache: "no-store", redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]),
  });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok || data.status === "invalid" || data.status === "rejected") {
    throw new Error(typeof data.reason === "string" && Object.hasOwn(reasons, data.reason)
      ? reasons[data.reason] : "The requested test evidence is unavailable.");
  }
  return data;
}

function boundRequest(request: TestLifecycleRequest, binding: Binding) {
  return same(request.factory, binding.factory) && same(request.token, binding.token) &&
    same(request.blockNumber, binding.blockNumber) && same(request.blockHash, binding.blockHash);
}

function readState(data: Record<string, unknown>, binding: Binding, account?: string) {
  const state = data.state as (TestLifecycleState & { lifecycle: FixtureLifecycle }) | undefined;
  if (data.status !== "ready" || !state || !same(state.factory, binding.factory) || !same(state.token, binding.token)
      || !state.lifecycle || !same(state.curve, state.lifecycle.activeCurve)
      || !/^(?:curve|eligible|graduated)$/.test(state.phase) || !/^0x[0-9a-f]{1,16}$/i.test(state.blockNumber)
      || !isTransactionHash(state.blockHash) || state.feeBps !== 100
      || ![state.inventoryWei, state.backingWei, state.soldWei, state.totalSupplyWei, state.targetBackingWei, state.targetSoldWei].every(uint)
      || state.targetSoldWei === "0" || state.targetBackingWei === "0" || state.totalSupplyWei === "0" ||
      (state.priceWei !== null && !uint(state.priceWei))
      || (account && (!state.account || ![state.account.ethWei, state.account.tokenWei, state.account.allowanceWei].every(uint)))) {
    throw new Error("Current curve evidence is unavailable.");
  }
  return state;
}

function readQuote(quote: unknown, request: TestLifecycleRequest): quote is TestLifecycleQuote {
  if (!quote || typeof quote !== "object") return false;
  const q = quote as TestLifecycleQuote;
  if (![q.inputWei, q.outputWei, q.minimumOutputWei, q.feeWei, q.refundWei, q.gasUnits, q.gasPriceWei].every(uint)
      || q.inputWei !== request.amountWei || q.minimumOutputWei !== request.minimumOutputWei) return false;
  if (request.operation !== "buy" && request.operation !== "sell") {
    return q.outputWei === "0" && q.feeWei === "0" && q.refundWei === "0";
  }
  return BigInt(q.minimumOutputWei) === BigInt(q.outputWei) * BigInt(10_000 - request.slippageBps) / 10_000n
    && (request.operation === "buy" ? BigInt(q.feeWei) + BigInt(q.refundWei) <= BigInt(q.inputWei) : q.refundWei === "0");
}

async function prepare(binding: Binding, account: string, operation: TestLifecycleOperation,
    amountWei: string, slippageBps: number, prior?: TestLifecycleRequest) {
  const payload = await lifecyclePost({ action: "prepare", token: binding.token, account, operation, amountWei, slippageBps,
    ...(prior && { prior }) });
  const { request, quote } = payload;
  if (payload.status !== "prepared" || !isTestLifecycleRequest(request) || !boundRequest(request, binding)
      || !same(request.from, account) || request.operation !== operation || request.amountWei !== amountWei
      || request.slippageBps !== slippageBps || !readQuote(quote, request) || !await lifecycleCalldataMatches(request)) {
    throw new Error("Test quote or transaction could not be bound to the reviewed terms.");
  }
  return { request, quote };
}

async function readResult(entry: TestTradeJournalEntry, manualHash?: string): Promise<TestLifecycleVerification> {
  const transactionHash = manualHash ?? entry.transactionHash;
  const data = await lifecyclePost({ action: "verify", request: entry.request, ...(transactionHash && { transactionHash }) });
  const { status, transactionHash: hash, indexed, settlementPending, outputWei, feeWei, refundWei } = data;
  if ((status !== "pending" && status !== "confirmed" && status !== "reverted" && status !== "unavailable")
      || (hash !== undefined && (!isTransactionHash(hash) || (transactionHash && !same(hash, transactionHash))))
      || ((status === "confirmed" || status === "reverted") && (!isTransactionHash(hash) || typeof indexed !== "boolean"))
      || ((status === "confirmed" && (entry.request.operation === "buy" || entry.request.operation === "sell"))
        && ![outputWei, feeWei, refundWei].every(uint))) throw new Error("The original transaction could not be verified.");
  return { status, transactionHash: isTransactionHash(hash) ? hash : undefined, indexed: indexed === true,
    settlementPending: settlementPending === true, outputWei: uint(outputWei) ? outputWei : undefined,
    feeWei: uint(feeWei) ? feeWei : undefined, refundWei: uint(refundWei) ? refundWei : undefined };
}

function canContinue(result: TestLifecycleVerification | undefined) {
  return !!result?.indexed && (result.status === "confirmed" || result.status === "reverted");
}

function priorJournalEntries(journal: TestTradeJournal, token: string, account?: string) {
  const tokenEntry = journal.history.find((entry) => same(entry.request.token, token));
  const accountEntry = account && journal.history.find((entry) => same(entry.request.from, account));
  return { tokenEntry, accountEntry: accountEntry && accountEntry !== tokenEntry ? accountEntry : undefined };
}

export function TestLifecycleWallet({ factory, token, blockNumber, blockHash, symbol, lifecycle }:
    Binding & { symbol?: string; lifecycle?: FixtureLifecycle }) {
  const binding = { factory, token, blockNumber, blockHash };
  const key = testTradeJournalKey(blockHash);
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wallet, setWallet] = useState<TestWallet>();
  const [snapshot, setSnapshot] = useState<TestLifecycleState>();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [observationError, setObservationError] = useState(false);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [review, setReview] = useState<Prepared>();
  const [journal, setJournal] = useState<TestTradeJournal>({ history: [] });
  const [result, setResult] = useState<TestLifecycleVerification>();
  const [restoreHash, setRestoreHash] = useState("");
  const [revision, setRevision] = useState(0);
  const [previousInvalid, setPreviousInvalid] = useState(false);
  const [walletUnavailable, setWalletUnavailable] = useState(false);
  const operation = useRef(false);
  const walletGeneration = useRef(0);
  const formRevision = useRef(0);
  const mounted = useRef(false);
  const hasRegistration = Boolean(lifecycle);

  useEffect(() => {
    if (!isLocalTestWallet(window.location) || !navigator.locks) {
      setWalletUnavailable(true);
      return;
    }
    mounted.current = true;
    function reload() {
      try {
        setJournal(readTestTradeJournal(key));
        setReady(true);
      } catch {
        setReady(false);
        setMessage("The test transaction journal could not be read. Signing is locked to protect the original request.");
      }
    }
    reload();
    function storageChanged(event: StorageEvent) {
      if (event.key !== key && event.key !== null) return;
      setReview(undefined);
      setResult(undefined);
      reload();
      setRevision((prior) => prior + 1);
    }
    window.addEventListener("storage", storageChanged);
    return () => {
      mounted.current = false;
      window.removeEventListener("storage", storageChanged);
    };
  }, [key]);

  useEffect(() => {
    if (!wallet) return;
    return subscribeTestWallet(wallet, () => {
      walletGeneration.current++;
      setWallet(undefined);
      setReview(undefined);
      setSnapshot(undefined);
      setMessage("Test wallet account or chain changed. Connect and review again.");
    });
  }, [wallet]);

  useEffect(() => {
    if (!hasRegistration) return;
    const controller = new AbortController();
    setSnapshot(undefined);
    setLoading(true);
    setObservationError(false);
    const expect = { factory, token, blockNumber, blockHash };
    const account = wallet?.account;
    lifecyclePost({ action: "state", token, ...(account && { account }) }, controller.signal).then((data) => {
      if (!controller.signal.aborted) setSnapshot(readState(data, expect, account));
    }).catch(() => {
      if (!controller.signal.aborted) setObservationError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [hasRegistration, factory, token, blockNumber, blockHash, revision, wallet]);

  const { tokenEntry, accountEntry } = priorJournalEntries(journal, token, wallet?.account);
  const priorEntries = [tokenEntry, accountEntry].filter((entry): entry is TestTradeJournalEntry => !!entry);
  useEffect(() => {
    const prior = [tokenEntry, accountEntry].filter((entry): entry is TestTradeJournalEntry => !!entry);
    if (!ready || !prior.length) {
      setPreviousInvalid(false);
      return;
    }
    let active = true;
    Promise.all(prior.map((entry) => readResult(entry))).then((data) => {
      if (active) setPreviousInvalid(data.some((result) => !canContinue(result)));
    }).catch(() => {
      if (active) setPreviousInvalid(true);
    });
    return () => { active = false; };
  }, [ready, tokenEntry, accountEntry, revision]);

  async function act(action: () => Promise<void>, fallback: string) {
    if (!ready || operation.current) return;
    operation.current = true;
    setBusy(true);
    setMessage("");
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : fallback); }
    finally {
      setBusy(false);
      operation.current = false;
    }
  }

  function invalidateReview() {
    formRevision.current++;
    setReview(undefined);
  }

  async function connect() {
    const connected = await connectTestWallet(binding);
    walletGeneration.current++;
    setReview(undefined);
    setWallet(connected);
  }

  async function reviewAction(selected: TestLifecycleOperation) {
    if (!wallet || !snapshot || journal.pending) return;
    setReview(undefined);
    const generation = walletGeneration.current;
    const form = formRevision.current;
    const amountWei = selected === "graduate" ? "0" : parseTradeAmount(amount);
    const slippageBps = selected === "buy" || selected === "sell" ? parseSlippage(slippage) : 0;
    if (!isLifecycleAmount(selected, amountWei)) throw new Error("Enter an amount within the isolated fixture limit.");
    if (!isLifecycleSlippage(selected, slippageBps)) throw new Error("Enter slippage from 0% through 5%.");
    const next = await prepare(binding, wallet.account, selected, amountWei, slippageBps);
    await assertTestWalletBinding(wallet, next.request);
    if (!same(next.request.curve, snapshot.curve) || generation !== walletGeneration.current
      || form !== formRevision.current || !mounted.current) throw new Error("The review changed. Review the current terms.");
    setReview({ ...next, wallet, formRevision: form });
  }

  async function reconcile(entry: TestTradeJournalEntry, journalAtLock: TestTradeJournal, manualHash?: string) {
    setResult(undefined);
    try {
      if (!boundRequest(entry.request, binding)) throw new Error("The original request belongs to another test token.");
      const settled = await readResult(entry, manualHash);
      if (settled.transactionHash && settled.status !== "unavailable" && !same(settled.transactionHash, entry.transactionHash)) {
        const updated = { ...journalAtLock, pending: { request: entry.request, transactionHash: settled.transactionHash } };
        writeTestTradeJournal(key, updated);
        setJournal(updated);
      }
      setResult(settled);
      setRevision((prior) => prior + 1);
      router.refresh();
      return settled;
    } catch {
      setResult({ status: "unavailable" });
    }
  }

  async function confirm() {
    if (!review || !hasRegistration || !snapshot || review.formRevision !== formRevision.current) return;
    const { wallet: bound, request, quote } = review;
    const generation = walletGeneration.current;
    setReview(undefined);
    await navigator.locks.request(key, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error("Another tab is handling the original test request.");
      const current = readTestTradeJournal(key);
      if (current.pending) {
        setJournal(current);
        throw new Error("Recover the pending transaction before submitting another request.");
      }
      const prior = priorJournalEntries(current, token, bound.account);
      for (const entry of [prior.tokenEntry, prior.accountEntry]) {
        if (entry && !canContinue(await readResult(entry))) throw new Error("The previous receipt is no longer verified. Refresh the test state.");
      }
      const fresh = await prepare(binding, bound.account, request.operation, request.amountWei, request.slippageBps, request);
      if (!sameTestLifecycleRequest(request, fresh.request) || quote.outputWei !== fresh.quote.outputWei ||
          quote.feeWei !== fresh.quote.feeWei || quote.refundWei !== fresh.quote.refundWei) {
        throw new Error("The quote changed. Review the new terms.");
      }
      const nonce = await bound.request.call(bound.provider, { method: "eth_getTransactionCount", params: [bound.account, "pending"] });
      await assertTestWalletBinding(bound, request);
      if (!sameWalletHex(nonce, request.nonce) || generation !== walletGeneration.current || review.formRevision !== formRevision.current
        || testProviderAtWindow() !== bound.provider || bound.provider.request !== bound.request || !mounted.current) {
        throw new Error("The wallet or reviewed terms changed. Review again.");
      }
      let entry: TestTradeJournalEntry = { request };
      const record = { ...current, pending: entry };
      writeTestTradeJournal(key, record);
      setJournal(record);
      setResult(undefined);
      try {
        const { from, to, data, value, nonce, chainId } = request;
        const hash = await bound.request.call(bound.provider, { method: "eth_sendTransaction", params: [{ from, to, data, value, chainId, nonce }] });
        if (isTransactionHash(hash)) {
          entry = { request, transactionHash: hash };
          const received = { ...current, pending: entry };
          writeTestTradeJournal(key, received);
          setJournal(received);
          await reconcile(entry, received);
        } else {
          setMessage("The wallet returned no hash. Check the original transaction before continuing.");
        }
      } catch (error) {
        if (testWalletErrorCode(error) === 4001) {
          writeTestTradeJournal(key, current);
          setJournal(current);
          setMessage("Request declined in your test wallet.");
        } else {
          setMessage("The wallet result is uncertain. Check the original transaction before continuing.");
        }
      }
    });
  }

  async function recover(manual = false, complete = false) {
    const hash = restoreHash.trim();
    if (manual && !isTransactionHash(hash)) throw new Error("Enter the 32-byte transaction hash from your test wallet.");
    await navigator.locks.request(key, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error("Another tab is handling the original test request.");
      const current = readTestTradeJournal(key);
      const entry = current.pending;
      if (!entry || !boundRequest(entry.request, binding)) throw new Error("The original request belongs to another test token.");
      setJournal(current);
      const settled = await reconcile(entry, current, manual ? hash : undefined);
      if (complete && canContinue(settled) && settled?.transactionHash) {
        const next = archiveTestTrade(current, { request: entry.request, transactionHash: settled.transactionHash });
        writeTestTradeJournal(key, next);
        setJournal(next);
        setRestoreHash("");
        setResult(undefined);
      }
    });
  }

  const pending = journal.pending;
  const thisPage = pending && boundRequest(pending.request, binding) ? pending : undefined;
  const unit = symbol ?? "tokens";
  const account = snapshot?.account;
  const phase = snapshot?.phase ?? lifecycle?.phase;
  const amountWei = /^\d{1,12}(?:\.\d{1,18})?$/.test(amount) ? parseTradeAmount(amount) : undefined;
  const approvalNeeded = side === "sell" && !!account && !!amountWei && BigInt(amountWei) > 0n && account.allowanceWei !== amountWei;
  const chosenOperation = approvalNeeded ? "approve" : side;
  const canSign = ready && !busy && !!snapshot && !!wallet && !!account && !pending && !previousInvalid;
  const progress = snapshot && BigInt(snapshot.soldWei) * 10_000n / BigInt(snapshot.targetSoldWei);
  const soldShare = snapshot && BigInt(snapshot.soldWei) * 10_000n / BigInt(snapshot.totalSupplyWei);
  const currentReview = review && review.wallet === wallet && review.formRevision === formRevision.current ? review : undefined;
  const status = result?.status;
  const trade = thisPage?.request.operation === "buy" || thisPage?.request.operation === "sell";

  if (!hasRegistration && !pending) return null;

  return <section className="lpPanel lpForm lpTradeColumn" aria-label="Isolated test trading">
    <h2>Verified bonding curve</h2>
    {snapshot ? <>
      <p role="status">{phase === "graduated" ? "Curve trading is closed. Uniswap v4 custody has been verified."
        : phase === "eligible" ? "Backing reached the threshold. Buying is closed. Selling before graduation can reopen buying."
        : "Curve is open on the isolated test network."}</p>
      <dl className="lpFacts">
        <dt>Curve inventory</dt><dd>{formatTestAmount(snapshot.inventoryWei)} {unit}</dd>
        <dt>Curve ETH backing</dt><dd>{formatTestAmount(snapshot.backingWei)} of {formatTestAmount(snapshot.targetBackingWei)} test ETH</dd>
        <dt>Net tokens sold</dt><dd>{formatTestAmount(snapshot.soldWei)} {unit} · {formatTestPercent(soldShare ?? 0n)} of fixed supply</dd>
        <dt>Graduation progress</dt><dd>{formatTestPercent(progress ?? 0n)} of token target</dd>
        <dt>Curve fee</dt><dd>{formatTestPercent(snapshot.feeBps)} of gross test ETH</dd>
        {phase === "curve" && <><dt>Current curve price</dt><dd>{snapshot.priceWei === null ? "Unavailable" : `${formatTestAmount(snapshot.priceWei)} test ETH per token before fees and price impact`}</dd></>}
        <dt>Current state block</dt><dd>{BigInt(snapshot.blockNumber).toString()} · isolated chain only</dd>
        {account && <>
          <dt>Wallet test ETH</dt><dd>{formatTestAmount(account.ethWei)}</dd>
          <dt>Wallet {unit}</dt><dd>{formatTestAmount(account.tokenWei)}</dd>
          <dt>Curve token allowance</dt><dd>{formatTestAmount(account.allowanceWei)} {unit}</dd>
        </>}
      </dl>
    </> : <p role="status">{loading ? "Verifying current curve state…" : "Current curve evidence is unavailable."}</p>}
    <button className="lpButton lpSecondary" type="button" disabled={busy}
      onClick={() => { invalidateReview(); setRevision((prior) => prior + 1); router.refresh(); }}>Refresh test state</button>
    {walletUnavailable && <p>Test signing requires a loopback browser with Web Locks support.</p>}
    {observationError && <p>Amounts and trading controls require a current verified observation.</p>}
    {previousInvalid && !pending && <div className="lpReview">
      <p role="status">The previous transaction is awaiting renewed canonical evidence. Refresh test state to check it again.</p>
      {priorEntries.map((entry) => <dl className="lpFacts" key={entry.transactionHash}>
        <dt>Original transaction hash</dt><dd><code className="lpAddress">{entry.transactionHash}</code></dd>
        <dt>Original wallet nonce</dt><dd>{BigInt(entry.request.nonce).toString()}</dd>
      </dl>)}
    </div>}
    {thisPage ? <>
      <p role="status">{status === "confirmed" ? `On-chain ${operationLabel[thisPage.request.operation]} confirmed`
        : status === "reverted" ? "Original transaction reverted"
          : status === "unavailable" ? "Original transaction evidence unavailable"
            : result?.settlementPending ? "Receipt observed. Canonical settlement is pending." : "Original transaction pending"}</p>
      {status === "confirmed" && !result?.indexed && <p>Awaiting the verified index checkpoint.</p>}
      <dl className="lpFacts">
        <dt>Original test account</dt><dd><code className="lpAddress">{thisPage.request.from}</code></dd>
        <dt>Original wallet nonce</dt><dd>{BigInt(thisPage.request.nonce).toString()}</dd>
        <dt>Original transaction hash</dt><dd><code className="lpAddress">{thisPage.transactionHash ?? "Awaiting evidence"}</code></dd>
        {trade && result?.outputWei !== undefined && result.feeWei !== undefined && <>
          <dt>Verified output</dt><dd>{formatTestAmount(result.outputWei)} {thisPage.request.operation === "buy" ? unit : "test ETH"}</dd>
          <dt>Verified fee</dt><dd>{formatTestAmount(result.feeWei)} test ETH</dd>
          {result.refundWei !== undefined && result.refundWei !== "0" && <><dt>Verified refund</dt><dd>{formatTestAmount(result.refundWei)} test ETH</dd></>}
        </>}
      </dl>
      <button type="button" className="lpButton lpSecondary" disabled={!ready || busy}
        onClick={() => void act(() => recover(), "Original transaction evidence unavailable.")}>Check original transaction</button>
      {(!thisPage.transactionHash || status === "unavailable") && <>
        <label>Original trade or graduation hash<input value={restoreHash} onChange={(event) => setRestoreHash(event.target.value)}
          autoComplete="off" maxLength={66} spellCheck={false} /></label>
        <button type="button" className="lpButton lpSecondary" disabled={!ready || busy}
          onClick={() => void act(() => recover(true), "The hash could not be matched to the original request.")}>Recover with transaction hash</button>
      </>}
      {canContinue(result) && <button type="button" className="lpButton" disabled={!ready || busy}
        onClick={() => void act(() => recover(false, true), "The original receipt is unavailable.")}>Continue from verified transaction</button>}
    </> : pending ? <p role="status">An original request is pending on <a className="lpBack" href={`/launches/${pending.request.token}`}>its test token page</a>.</p>
      : snapshot && phase !== "graduated" && <>
        {!wallet ? <button type="button" className="lpButton lpSecondary" disabled={!ready || busy}
          onClick={() => void act(connect, "Connect an injected test wallet on chain 31337.")}>Connect test trading wallet</button>
          : <>
            <p>Connected test account <code className="lpAddress">{wallet.account}</code></p>
            <fieldset disabled={busy}>
              <legend>Review a synthetic curve trade</legend>
              <label>Curve trade<select value={side} onChange={(event) => { invalidateReview(); setSide(event.target.value === "sell" ? "sell" : "buy"); }}>
                <option value="buy">Buy</option><option value="sell">Sell</option>
              </select></label>
              <div className="lpFormGrid">
                <div className="lpDraftField"><label>Trade amount<input value={amount} onChange={(event) => { invalidateReview(); setAmount(event.target.value); }}
                  inputMode="decimal" maxLength={31} aria-describedby="fixture-trade-unit" /></label>
                  <small id="fixture-trade-unit">{side === "buy" ? "Synthetic ETH budget" : unit}</small></div>
                <div className="lpDraftField"><label>Slippage (%)<input value={slippage} onChange={(event) => { invalidateReview(); setSlippage(event.target.value); }}
                  inputMode="decimal" maxLength={4} aria-describedby="fixture-trade-slippage" /></label>
                  <small id="fixture-trade-slippage">0% to 5%</small></div>
              </div>
            </fieldset>
            <button type="button" className="lpButton lpSecondary" disabled={!canSign || (phase === "eligible" && side === "buy")}
              onClick={() => void act(() => reviewAction(chosenOperation), "Cannot review this trade.")}>Review {operationLabel[chosenOperation]}</button>
            {phase === "eligible" && <button type="button" className="lpButton lpSecondary" disabled={!canSign}
              onClick={() => void act(() => reviewAction("graduate"), "Graduation proof is unavailable.")}>Review test graduation</button>}
          </>}
      </>}
    {currentReview && !pending && <TransactionReview review={currentReview} symbol={unit} busy={busy}
      confirm={() => void act(confirm, "Wallet or reviewed terms changed. Review again.")} />}
    {message && <p role="alert">{message}</p>}
  </section>;
}

function TransactionReview({ review, symbol, busy, confirm }: { review: Prepared; symbol: string; busy: boolean; confirm(): void }) {
  const { request, quote } = review;
  const trade = request.operation === "buy" || request.operation === "sell";
  const buy = request.operation === "buy";
  const input = buy ? "test ETH" : symbol;
  const output = buy ? symbol : "test ETH";
  return <div className="lpReview">
    <h3>Review {operationLabel[request.operation]}</h3>
    <dl className="lpFacts">
      <dt>Destination</dt><dd><code className="lpAddress">{request.to}</code></dd>
      {request.operation === "approve" && <>
        <dt>Exact allowance</dt><dd>{formatTestAmount(request.amountWei)} {symbol}</dd>
        <dt>Approved spender</dt><dd><code className="lpAddress">{request.curve}</code></dd>
      </>}
      {trade && <>
        <dt>{buy ? "Exact ETH budget" : "Exact token input"}</dt><dd>{formatTestAmount(request.amountWei)} {input}</dd>
        <dt>Quoted output</dt><dd>{formatTestAmount(quote.outputWei)} {output}</dd>
        <dt>Minimum output</dt><dd>{formatTestAmount(quote.minimumOutputWei)} {output}</dd>
        <dt>Reviewed slippage</dt><dd>{formatTestPercent(request.slippageBps)}</dd>
        <dt>Curve fee</dt><dd>{formatTestAmount(quote.feeWei)} test ETH</dd>
        {buy && <><dt>Expected refund</dt><dd>{formatTestAmount(quote.refundWei)} test ETH</dd></>}
      </>}
      <dt>Gas estimate</dt><dd>{quote.gasUnits} gas · approx. {formatTestAmount(BigInt(quote.gasUnits) * BigInt(quote.gasPriceWei))} test ETH</dd>
      <dt>Review deadline</dt><dd>{new Date(Number(request.deadline) * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC")}</dd>
    </dl>
    <button type="button" className="lpButton" disabled={busy} onClick={confirm}>Confirm {operationLabel[request.operation]}</button>
  </div>;
}
