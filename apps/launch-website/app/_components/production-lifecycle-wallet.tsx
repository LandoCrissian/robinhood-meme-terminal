"use client";
import { withProductionNonceStore } from "../../lib/production-nonce-store";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { parseUnits } from "viem";
import { isProductionLifecycleRequest, productionLifecycleCalldataMatches, productionLifecyclePath, productionTradingPins,
  type ProductionLifecycleOperation, type ProductionLifecycleQuote, type ProductionLifecycleRequest,
  type ProductionLifecycleState, type ProductionLifecycleVerification } from "../../lib/production-lifecycle";
import { clearProductionTradeJournal, readProductionTradeJournal, submitProductionTrade, updateProductionTradeJournalFromVerification, type ProductionTradeJournal } from "../../lib/production-trading-wallet";
import { assertProductionWalletBinding, connectProductionFinancialWallet, productionAccountLock, productionProviderAtWindow,
  readProductionCapability, type ProductionWallet } from "../../lib/production-wallet";
import { sameLifecycleValue as same } from "../../lib/test-lifecycle";
import { isTransactionHash } from "../../lib/test-creation";
import { subscribeTestWallet } from "../../lib/test-wallet";
import { formatTestAmount as amount, formatTestPercent as percent } from "./fixture-lifecycle-evidence";

const labels: Record<ProductionLifecycleOperation, string> = { buy: "buy", "buy-graduate": "final buy and v4 graduation", sell: "sell", approve: "exact curve approval", graduate: "graduation",
  "v4-buy": "v4 buy", "v4-sell": "v4 sell", "v4-token-approve": "exact token approval", "v4-permit2-approve": "exact Permit2 approval" };
const uint = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 2n ** 256n;
const native = (op: ProductionLifecycleOperation) => op === "buy" || op === "buy-graduate" || op === "v4-buy";
const approval = (op: ProductionLifecycleOperation) => ["approve", "v4-token-approve", "v4-permit2-approve"].includes(op);
type Prepared = { request: ProductionLifecycleRequest; quote: ProductionLifecycleQuote; revision: number; wallet: ProductionWallet };
async function post(body: object) {
  const response = await fetch(productionLifecyclePath, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok || data.status === "unavailable" || data.status === "invalid") {
    const reasons: Record<string, string> = {
      "insufficient-allowance": "Approve the selected token amount before selling.",
      "insufficient-balance": "Your balance does not cover this amount and the network fee.",
      "stale-review": "This quote has expired. Review the current price before continuing.",
      "curve-closed": "The market has changed. Refresh to use its current trading route.",
      "graduation-not-ready": "Graduation is not available for this amount. Refresh the quote.",
      "amount-unavailable": "This amount cannot be used for the selected transaction.",
    };
    throw new Error(response.status === 404 ? "Website trading is not enabled."
      : response.status === 429 ? "Trading checks are busy. Wait a moment and try again."
      : reasons[String(data.reason)] ?? "Current prices could not be verified. Your amount is unchanged; try again shortly.");
  }
  return data;
}
function stateMatches(s: ProductionLifecycleState, token: string, curve: string) {
  return s && same(s.factory, productionTradingPins.factory) && same(s.token, token) && same(s.curve, curve)
    && ["curve", "eligible", "graduated"].includes(s.phase) && isTransactionHash(s.blockHash)
    && /^0x[1-9a-f][0-9a-f]*$/i.test(s.blockNumber) && s.feeBps === 100
    && [s.inventoryWei, s.backingWei, s.soldWei, s.totalSupplyWei, s.targetBackingWei, s.targetSoldWei].every(uint)
    && s.totalSupplyWei === (10n ** 27n).toString() && s.targetBackingWei === (2n * 10n ** 18n).toString()
    && s.targetSoldWei === (6n * 10n ** 26n).toString()
    && (!s.account || [s.account.ethWei, s.account.tokenWei, s.account.allowanceWei].every(uint))
    && (!s.postGraduation?.balances || [s.postGraduation.balances.erc20AllowanceWei, s.postGraduation.balances.permit2AllowanceWei].every(uint)
      && [s.postGraduation.balances.permit2Expiration, s.postGraduation.balances.chainTimestamp].every(value => Number.isSafeInteger(value) && value >= 0))
    && (s.phase !== "graduated" || !!s.postGraduation && same(s.postGraduation.router, productionTradingPins.router)
      && same(s.postGraduation.permit2, productionTradingPins.permit2) && same(s.postGraduation.poolKey.hooks, productionTradingPins.guard));
}
export function ProductionLifecycleWallet({ token, curve, symbol }: { token: string; curve: string; symbol: string }) {
  const id = useId(), revision = useRef(0), active = useRef(true), running = useRef(false);
  const [wallet, setWallet] = useState<ProductionWallet | null>(null), [state, setState] = useState<ProductionLifecycleState | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy"), [input, setInput] = useState(""), [slippage, setSlippage] = useState("1");
  const [review, setReview] = useState<Prepared | null>(null), [journal, setJournal] = useState<ProductionTradeJournal | null>(null);
  const [result, setResult] = useState<ProductionLifecycleVerification | null>(null), [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [progress, setProgress] = useState("");
  const [indicative,setIndicative] = useState("");
  useEffect(()=>{
    setIndicative("");
    if(!wallet || !state || journal || review || !/^\d{1,12}(\.\d{1,18})?$/.test(input) || parseUnits(input,18)<=0n)return;
    let alive=true, retry:ReturnType<typeof setTimeout>;
    async function quote(){try{
      const r=await post({action:"quote",token,side,amountWei:parseUnits(input,18).toString()});
      if(alive)setIndicative(r.status==="ready" && uint(r.outputWei) && uint(r.blockNumber) ?
        "Estimated receive: "+amount(r.outputWei)+" "+(side==="buy"?symbol:"ETH") + (typeof r.outputImpactBps === "number" && Number.isSafeInteger(r.outputImpactBps) ? " · Price impact incl. fee: " + percent(r.outputImpactBps) : "") : "Quote unavailable. Try again shortly.");
    }catch{if(alive)setIndicative("Quote unavailable. Refresh before reviewing.");}
    finally{if(alive)retry=setTimeout(quote,15000);}}
    const timer=setTimeout(()=>void quote(),550);return()=>{alive=false;clearTimeout(timer);clearTimeout(retry);};
  },[wallet,state,input,side,token,symbol,journal,review]);
  const invalidate = () => { revision.current++; setReview(null); };
  useEffect(() => { active.current = true; return () => { active.current = false; revision.current++; }; }, []);
  useEffect(() => {
    if (!wallet) return;
    return subscribeTestWallet(wallet, () => { invalidate(); setWallet(null); setState(null); setMessage("Wallet account or network changed. Recover the original transaction before another request."); });
  }, [wallet]);
  useEffect(() => { const invalidateStored = () => { invalidate(); if (wallet) {
    try { setJournal(readProductionTradeJournal(localStorage, wallet.account, token)); } catch { setMessage("Recovery storage is unavailable. Preserve the original request."); }
  } }; window.addEventListener("storage", invalidateStored); return () => window.removeEventListener("storage", invalidateStored); }, [wallet, token]);
  async function run(work: () => Promise<void>, label = "Checking market…") {
    if (running.current) return;
    running.current = true; setBusy(true); setMessage(""); setProgress(label);
    try { await work(); } catch (error) { setReview(null); setMessage(error instanceof Error ? error.message : "Transaction evidence unavailable"); }
    finally { running.current = false; if (active.current) { setBusy(false); setProgress(""); } }
  }
  async function refresh(account = wallet?.account) {
    invalidate(); const version = revision.current;
    const r = await post({ action: "state", token, ...(account && { account }) });
    if (r.status !== "ready" || !stateMatches(r.state as ProductionLifecycleState, token, curve)) throw new Error("Market bindings or economics could not be verified");
    if (!active.current || version !== revision.current) throw new Error("Market selection changed");
    setState(r.state as ProductionLifecycleState);
    if (account) setJournal(readProductionTradeJournal(localStorage, account, token));
  }
  async function connect() {
    invalidate(); const version = revision.current, connected = await connectProductionFinancialWallet("trading");
    if (!active.current || version !== revision.current) throw new Error("Wallet selection changed");
    setWallet(connected); await refresh(connected.account);
  }
  async function prepare(operation: ProductionLifecycleOperation) {
    if (!wallet || !state) throw new Error("Connect and verify market state first");
    invalidate(); const version = revision.current, binding = await readProductionCapability("trading");
    if (!/^\d{1,12}(?:\.\d{1,18})?$/.test(input) && operation !== "graduate") throw new Error("Enter a positive amount with up to 18 decimal places");
    if (!/^[0-5](?:\.\d{1,2})?$/.test(slippage)) throw new Error("Enter slippage between 0% and 5%");
    const amountWei = operation === "graduate" ? "0" : parseUnits(input, 18).toString();
    const r = await post({ action: "prepare", token, account: wallet.account, operation, amountWei,
      slippageBps: approval(operation) || operation === "graduate" ? 0 : Number(parseUnits(slippage, 2)) });
    const request = r.request, quote = r.quote as ProductionLifecycleQuote;
    if (r.status !== "prepared" || !isProductionLifecycleRequest(request) || !same(request.token, token) || !same(request.curve, curve)
      || !same(request.from, wallet.account) || request.operation !== operation || request.amountWei !== amountWei || request.approvalBinding !== binding
      || !await productionLifecycleCalldataMatches(request) || !quote || ![quote.inputWei, quote.outputWei, quote.minimumOutputWei, quote.feeWei,
        quote.refundWei, quote.gasUnits, quote.gasPriceWei].every(uint) || quote.inputWei !== amountWei || quote.minimumOutputWei !== request.minimumOutputWei) throw new Error("The reviewed transaction differs from your terms");
    await assertProductionWalletBinding(wallet, request);
    if (version !== revision.current || !active.current) throw new Error("Wallet or selected terms changed");
    setReview({ request, quote, revision: version, wallet });
  }
  async function locked(account: string, work: () => Promise<void>) {
    if (!navigator.locks?.request) throw new Error("This browser cannot safely coordinate wallet transactions");
    await navigator.locks.request(productionAccountLock(account), { mode: "exclusive", ifAvailable: true }, async lock => {
      if (!lock) throw new Error("Another tab is handling this wallet. Recover its original request");
      await work();
    });
  }
  async function confirm() {
    if (!wallet || !review || review.wallet !== wallet || review.revision !== revision.current) throw new Error("Review current terms first");
    const original = review, version = revision.current;
    const guard = () => { if (!active.current || revision.current !== version || productionProviderAtWindow() !== wallet.provider
      || wallet.provider.request !== wallet.request) throw new Error("Wallet or reviewed terms changed"); };
    setReview(null);
    // The sender owns the shared financial account lock through durable write
    // and the sole wallet request. Acquiring it twice would deadlock the flow.
    try { const verification = await submitProductionTrade(wallet, original, localStorage, fetch, guard); setResult(verification); }
    finally { setJournal(readProductionTradeJournal(localStorage, wallet.account, token)); }
  }
  async function recover(continueAfter = false) {
    if (!journal) throw new Error("No original request to recover");
    const entered = hash.trim(); if (entered && !isTransactionHash(entered)) throw new Error("Enter the complete original transaction hash");
    await locked(journal.request.from, async () => {
      const r = await post({ action: "verify", request: journal.request, ...((entered || journal.transactionHash) && { transactionHash: entered || journal.transactionHash }) }) as ProductionLifecycleVerification;
      if (!["pending", "confirmed", "reverted", "unavailable"].includes(r.status) || (r.transactionHash && !isTransactionHash(r.transactionHash))) throw new Error("Invalid original receipt evidence");
      setResult(r);
      await withProductionNonceStore(localStorage, view => updateProductionTradeJournalFromVerification(view, journal.request.from, token, r));
      setJournal(readProductionTradeJournal(localStorage, journal.request.from, token));
      if (continueAfter) { await withProductionNonceStore(localStorage, view => clearProductionTradeJournal(view, journal.request.from, token, r)); setJournal(null); setHash(""); await refresh(); }
    });
  }
  const v4 = state?.postGraduation;
  let terminalBuy = false;
  if (!v4 && side==="buy" && state?.phase==="curve" && /^\d{1,12}(\.\d{0,18})?$/.test(input)) {
    terminalBuy = parseUnits(input,18)*99n/100n >= BigInt(state.targetBackingWei)-BigInt(state.backingWei);
  }
  const trade: ProductionLifecycleOperation = v4 ? side === "buy" ? "v4-buy" : "v4-sell" : terminalBuy ? "buy-graduate" : side;
  const current = review?.wallet === wallet && review.revision === revision.current ? review : null;
  const enteredAmount = /^\d{1,12}(?:\.\d{1,18})?$/.test(input) ? parseUnits(input, 18) : 0n;
  const sellPermissions = side === "sell" && enteredAmount > 0n && state?.account;
  const needsTokenApproval = !!sellPermissions && (v4
    ? !!v4.balances && BigInt(v4.balances.erc20AllowanceWei) !== enteredAmount
    : BigInt(state!.account!.allowanceWei) !== enteredAmount);
  const needsPermitApproval = !!sellPermissions && !!v4?.balances && !needsTokenApproval
    && (BigInt(v4.balances.permit2AllowanceWei) !== enteredAmount
      || v4.balances.permit2Expiration < v4.balances.chainTimestamp + 180);
  const nextOperation: ProductionLifecycleOperation = needsTokenApproval ? v4 ? "v4-token-approve" : "approve"
    : needsPermitApproval ? "v4-permit2-approve" : trade;
  const nextLabel = needsTokenApproval ? "Review token approval" : needsPermitApproval ? "Review Permit2 approval"
    : side === "buy" ? "Review buy" : "Review sell";
  const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
  return <section className="lpForm lpTradeColumn rmLiveOrder" aria-label={`Trade ${symbol}`}>
    <div className="rmOrderHeading"><h2>Trade {symbol}</h2>
      <span className="rmOrderNetwork">Robinhood Chain</span></div>
    {!journal && <>
      <div className="rmToggle" aria-label="Trade side">
        {(["buy", "sell"] as const).map(value => <button key={value} type="button" aria-pressed={side === value} disabled={busy}
          onClick={() => { invalidate(); setSide(value); }}>{value === "buy" ? "Buy" : "Sell"}</button>)}
      </div>
      <label className="rmAmountLabel" htmlFor={`${id}-amount`}>
        <span>You pay <span className="rmInputAsset">{side === "buy" ? "ETH" : symbol}</span></span>
        <input id={`${id}-amount`} value={input} inputMode="decimal" autoComplete="off" placeholder="0.00" maxLength={31}
          disabled={busy} onChange={e => { invalidate(); setInput(e.target.value); }} />
      </label>
      {state?.account && <p className="rmBalance">Balance: {amount(side === "buy" ? state.account.ethWei : state.account.tokenWei)} {side === "buy" ? "ETH" : symbol}</p>}
      <details className="rmTradeSettings"><summary>Slippage <span>{slippage || "—"}%</span></summary>
        <label htmlFor={`${id}-slippage`}>Maximum slippage (%)<input id={`${id}-slippage`} value={slippage} inputMode="decimal"
          disabled={busy} maxLength={4} onChange={e => { invalidate(); setSlippage(e.target.value); }} /></label>
        <small>{v4 ? "Choose 0.10% to 5%." : "Choose 0% to 5%."}</small>
      </details>
      {indicative && !current && <p className="rmQuoteHint" role="status">{indicative}</p>}
      {!current && <>
        {!wallet ? <button className="lpButton" disabled={busy} onClick={() => void run(connect, "Connecting wallet…")}>Connect wallet</button>
          : !state ? <button className="lpButton" disabled={busy} onClick={() => void run(() => refresh(), "Checking price…")}>Retry market check</button>
          : <>
            {(needsTokenApproval || needsPermitApproval) && <p className="rmQuoteHint">Approve only this amount, then confirm your sell.</p>}
            <button className="lpButton" disabled={busy || enteredAmount <= 0n || state.phase === "eligible" && side === "buy"}
              onClick={() => void run(() => prepare(nextOperation), "Preparing review…")}>{nextLabel}</button>
            {state.phase === "eligible" && <button className="lpButton lpSecondary" disabled={busy}
              onClick={() => void run(() => prepare("graduate"), "Preparing graduation…")}>Review graduation</button>}
          </>}
      </>}
    </>}
    {journal && <div className="lpRecovery lpForm rmRecovery"><h3>{result?.status === "confirmed" && result.indexed ? "Transaction confirmed" : "Transaction status"}</h3>
      <p role="status">{result?.status === "confirmed" && result.indexed ? "Confirmed on Robinhood Chain and included in market activity."
        : result?.status === "reverted" ? "This transaction reverted. Check the result before continuing."
        : "Your original request is saved. Check its status before submitting another transaction."}</p>
      {journal.transactionHash && <a className="rmTransactionLink" href={`https://robinhoodchain.blockscout.com/tx/${journal.transactionHash}`}
        target="_blank" rel="noopener noreferrer">View transaction ↗</a>}
      <details className="rmTradeSettings"><summary>Recovery details</summary>
        <p>{labels[journal.request.operation]} · wallet nonce {BigInt(journal.request.nonce).toString()}</p>
        <code className="lpAddress">{journal.transactionHash ?? "Waiting for the wallet transaction hash"}</code>
        <label>Original transaction hash<input value={hash} onChange={e => setHash(e.target.value)} maxLength={66} spellCheck={false} /></label>
        <small>Ethereum L1 settlement has not been verified.</small>
      </details>
      <button className="lpButton lpSecondary" disabled={busy} onClick={() => void run(() => recover(), "Checking transaction…")}>Check transaction</button>
      {(result?.status === "reverted" || result?.status === "confirmed" && result.indexed === true) && <button className="lpButton" disabled={busy}
        onClick={() => void run(() => recover(true), "Refreshing market…")}>Continue trading</button>}
    </div>}
    {current && !journal && <div className="lpReview rmTradeReview"><h3>Review {labels[current.request.operation]}</h3>
      <dl className="lpFacts">
        {current.request.operation !== "graduate" && <><dt>{approval(current.request.operation) ? "Approve" : "You pay"}</dt><dd>{amount(current.request.amountWei)} {native(current.request.operation) ? "ETH" : symbol}</dd></>}
        {!approval(current.request.operation) && current.request.operation !== "graduate" && <>
          <dt>Estimated receive</dt><dd>{amount(current.quote.outputWei)} {native(current.request.operation) ? symbol : "ETH"}</dd>
          <dt>Minimum receive</dt><dd>{amount(current.request.minimumOutputWei)} {native(current.request.operation) ? symbol : "ETH"}</dd>
          <dt>Trading fee</dt><dd>{amount(current.quote.feeWei)} {current.quote.feeAsset === "token" ? symbol : "ETH"}</dd>
          {typeof current.quote.outputImpactBps === "number" && Number.isSafeInteger(current.quote.outputImpactBps) && <><dt>Price impact incl. fee</dt><dd>{percent(current.quote.outputImpactBps)}</dd></>}
          <dt>Slippage</dt><dd>{percent(current.request.slippageBps)}</dd>
        </>}
        {BigInt(current.quote.refundWei) > 0n && <><dt>Expected refund</dt><dd>{amount(current.quote.refundWei)} ETH</dd></>}
        <dt>Maximum network fee</dt><dd>{amount(BigInt(current.quote.gasUnits) * BigInt(current.quote.gasPriceWei))} ETH</dd>
        {approval(current.request.operation) && <><dt>Approved spender</dt><dd className="lpAddress">{current.request.operation === "approve" ? curve : current.request.operation === "v4-token-approve" ? productionTradingPins.permit2 : productionTradingPins.router}</dd></>}
      </dl>
      <details className="rmTradeSettings"><summary>Transaction details</summary><dl className="lpFacts">
        <dt>Network</dt><dd>Robinhood Chain 4663</dd><dt>From</dt><dd className="lpAddress">{current.request.from}</dd>
        <dt>Destination</dt><dd className="lpAddress">{current.request.to}</dd>
        <dt>Deadline</dt><dd>{new Date(Number(current.request.deadline) * 1000).toLocaleTimeString()}</dd>
        <dt>Wallet nonce</dt><dd>{BigInt(current.request.nonce).toString()}</dd>
      </dl><p>Network fees include execution and data costs. Ethereum L1 settlement is not yet verified.</p>
        <p>Calldata</p><code className="lpAddress">{current.request.data}</code>
        <p>Release binding</p><code className="lpAddress">{current.request.approvalBinding}</code>
      </details>
      <div className="lpDraftActions"><button className="lpButton" disabled={busy} onClick={() => void run(confirm, "Opening wallet…")}>Confirm {labels[current.request.operation]}</button>
        <button className="lpTextButton" disabled={busy} onClick={invalidate}>Cancel</button></div>
    </div>}
    {busy && <p className="rmOrderStatus" role="status" aria-live="polite">{progress}</p>}
    {message && <div className="rmOrderError" role="alert"><p>{message}</p>
      {wallet && state && !journal && <button className="lpTextButton" disabled={busy} onClick={() => void run(() => refresh(), "Checking price…")}>Retry market check</button>}
    </div>}
    <div className="rmOrderFootnote">
      <span>{state ? v4 ? "0.30% pool fee" : "1% trading fee" : "Fee shown in review"} · network fee extra</span>
      {wallet && <span title={wallet.account}>{short(wallet.account)}</span>}
    </div>
    {v4 && <Link className="rmEarningsLink" href="/my-launches/earnings" prefetch={false}>Creator earnings ↗</Link>}
  </section>;
}
