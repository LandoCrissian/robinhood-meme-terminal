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
    throw new Error(data.reason === "insufficient-allowance" ? "Review the exact allowance before selling." : "Current transaction evidence is unavailable. Refresh and review again.");
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
  const [indicative,setIndicative] = useState("");
  useEffect(()=>{
    setIndicative("");
    if(!wallet || journal || review || !/^\d{1,12}(\.\d{1,18})?$/.test(input) || parseUnits(input,18)<=0n)return;
    let alive=true, retry:ReturnType<typeof setTimeout>;
    async function quote(){try{
      const r=await post({action:"quote",token,side,amountWei:parseUnits(input,18).toString()});
      if(alive)setIndicative(r.status==="ready" && uint(r.outputWei) && uint(r.blockNumber) ?
        "Estimated output "+amount(r.outputWei)+" "+(side==="buy"?symbol:"ETH")+" at block "+r.blockNumber : "Quote unavailable. Refresh before reviewing.");
    }catch{if(alive)setIndicative("Quote unavailable. Refresh before reviewing.");}
    finally{if(alive)retry=setTimeout(quote,15000);}}
    const timer=setTimeout(()=>void quote(),550);return()=>{alive=false;clearTimeout(timer);clearTimeout(retry);};
  },[wallet,input,side,token,symbol,journal,review]);
  const invalidate = () => { revision.current++; setReview(null); };
  useEffect(() => { active.current = true; return () => { active.current = false; revision.current++; }; }, []);
  useEffect(() => {
    if (!wallet) return;
    return subscribeTestWallet(wallet, () => { invalidate(); setWallet(null); setState(null); setMessage("Wallet account or network changed. Recover the original transaction before another request."); });
  }, [wallet]);
  useEffect(() => { const invalidateStored = () => { invalidate(); if (wallet) {
    try { setJournal(readProductionTradeJournal(localStorage, wallet.account, token)); } catch { setMessage("Recovery storage is unavailable. Preserve the original request."); }
  } }; window.addEventListener("storage", invalidateStored); return () => window.removeEventListener("storage", invalidateStored); }, [wallet, token]);
  async function run(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setMessage("");
    try { await work(); } catch (error) { setReview(null); setMessage(error instanceof Error ? error.message : "Transaction evidence unavailable"); }
    finally { running.current = false; if (active.current) setBusy(false); }
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
  return <section className="lpPanel lpForm lpTradeColumn" aria-label="Production trading">
    <h2>{v4 ? "Verified Uniswap v4 trading" : "Verified bonding curve"}</h2>
    <p role="status">Robinhood Chain 4663 · real assets. Every approval, trade and graduation requires separate wallet confirmation.</p>
    {state && <dl className="lpFacts"><dt>Market</dt><dd>{state.phase === "eligible" ? "Graduation threshold reached" : v4 ? "Original locked v4 position" : "Open curve"}</dd>
      <dt>Curve ETH backing</dt><dd>{amount(state.backingWei)} of {amount(state.targetBackingWei)} ETH</dd><dt>Curve tokens sold</dt><dd>{amount(state.soldWei)} {symbol}</dd>
      <dt>{v4 ? "Pool fee" : "Curve fee"}</dt><dd>{v4 ? "0.30% of input" : "1% of gross ETH"}</dd><dt>Verified state block</dt><dd>{BigInt(state.blockNumber).toString()}</dd>
      {state.account && <><dt>Wallet ETH</dt><dd>{amount(state.account.ethWei)}</dd><dt>Wallet {symbol}</dt><dd>{amount(state.account.tokenWei)}</dd></>}
      {v4 && <><dt>Canonical pool</dt><dd className="lpAddress">{v4.poolId}</dd><dt>Universal Router</dt><dd className="lpAddress">{v4.router}</dd></>}
    </dl>}
    <button className="lpButton lpSecondary" disabled={busy} onClick={() => void run(() => refresh())}>Refresh market state</button>
    {!wallet && <button className="lpButton lpSecondary" disabled={busy} onClick={() => void run(connect)}>Connect trading wallet</button>}
    {wallet && <p className="lpAddress">Connected account {wallet.account}</p>}
    {journal ? <div className="lpRecovery lpForm"><h3>Original {labels[journal.request.operation]}</h3>
      <p role="status">{result?.status === "confirmed" && result.indexed ? "Canonical L2 receipt and indexed activity verified. Ethereum L1 finality remains unverified." : result?.status === "reverted" ? "Original transaction reverted" : "Recover the original request before another transaction. No automatic resubmission."}</p>
      <code className="lpAddress">{journal.transactionHash ?? "Wallet hash missing · original payer and nonce retained"}</code>
      <p>Original wallet nonce {BigInt(journal.request.nonce).toString()}</p>
      <label>Original transaction hash<input value={hash} onChange={e => setHash(e.target.value)} maxLength={66} spellCheck={false} /></label>
      <button className="lpButton lpSecondary" disabled={busy} onClick={() => void run(() => recover())}>Check original transaction</button>
      {(result?.status === "reverted" || result?.status === "confirmed" && result.indexed === true) && <button className="lpButton" disabled={busy} onClick={() => void run(() => recover(true))}>Continue from verified transaction</button>}
    </div> : wallet && state && <>
      <fieldset disabled={busy}><legend>{v4 ? "Review a Uniswap v4 swap" : "Review a curve trade"}</legend>
        <label htmlFor={`${id}-side`}>Trade<select id={`${id}-side`} value={side} onChange={e => { invalidate(); setSide(e.target.value === "sell" ? "sell" : "buy"); }}><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
        <div className="lpFormGrid"><label htmlFor={`${id}-amount`}>Trade amount<input id={`${id}-amount`} value={input} inputMode="decimal" maxLength={31} onChange={e => { invalidate(); setInput(e.target.value); }} /><small>{side === "buy" ? "ETH budget" : symbol}</small></label>
          <label htmlFor={`${id}-slippage`}>Slippage (%)<input id={`${id}-slippage`} value={slippage} inputMode="decimal" maxLength={4} onChange={e => { invalidate(); setSlippage(e.target.value); }} /><small>{v4 ? "0.10% to 5%" : "0% to 5%"}</small></label></div>
      </fieldset>
      {indicative && <p role="status">{indicative}</p>}
      {side === "sell" && <div className="lpDraftActions"><button className="lpButton lpSecondary" disabled={busy} onClick={() => void run(() => prepare(v4 ? "v4-token-approve" : "approve"))}>Review exact token approval</button>
        {v4 && <button className="lpButton lpSecondary" disabled={busy} onClick={() => void run(() => prepare("v4-permit2-approve"))}>Review exact Permit2 approval</button>}</div>}
      <button className="lpButton lpSecondary" disabled={busy || state.phase === "eligible" && side === "buy"} onClick={() => void run(() => prepare(trade))}>Review {labels[trade]}</button>
      {state.phase === "eligible" && <button className="lpButton lpSecondary" disabled={busy} onClick={() => void run(() => prepare("graduate"))}>Review graduation</button>}
    </>}
    {current && !journal && <div className="lpReview"><h3>Review {labels[current.request.operation]}</h3><dl className="lpFacts">
      <dt>Destination</dt><dd className="lpAddress">{current.request.to}</dd><dt>Exact input / allowance</dt><dd>{amount(current.request.amountWei)} {native(current.request.operation) ? "ETH" : symbol}</dd>
      <dt>Quoted output</dt><dd>{amount(current.quote.outputWei)} {native(current.request.operation) ? symbol : "ETH"}</dd><dt>Minimum output</dt><dd>{amount(current.request.minimumOutputWei)}</dd>
      <dt>Slippage</dt><dd>{percent(current.request.slippageBps)}</dd><dt>Quoted fee</dt><dd>{amount(current.quote.feeWei)} {current.quote.feeAsset === "token" ? symbol : "ETH"}</dd>
      <dt>Expected refund</dt><dd>{amount(current.quote.refundWei)} ETH</dd><dt>Maximum proposed network cost</dt><dd>{amount(BigInt(current.quote.gasUnits) * BigInt(current.quote.gasPriceWei))} ETH</dd>
      <dt>Fee evidence</dt><dd>Corroborated Nitro execution and L1 data gas; L1 transaction finality remains unverified</dd>
      <dt>Deadline</dt><dd>{new Date(Number(current.request.deadline) * 1000).toISOString()}</dd><dt>Wallet nonce</dt><dd>{BigInt(current.request.nonce).toString()}</dd>
      {approval(current.request.operation) && <><dt>Approved spender</dt><dd className="lpAddress">{current.request.operation === "approve" ? curve : current.request.operation === "v4-token-approve" ? productionTradingPins.permit2 : productionTradingPins.router}</dd></>}
    </dl><details><summary>Exact calldata and approval binding</summary><code className="lpAddress">{current.request.data}</code><code className="lpAddress">{current.request.approvalBinding}</code></details>
      <div className="lpDraftActions"><button className="lpButton" disabled={busy} onClick={() => void run(confirm)}>Confirm {labels[current.request.operation]}</button><button className="lpTextButton" disabled={busy} onClick={invalidate}>Cancel review</button></div>
    </div>}
    {v4 && <p className="lpInlineNotice">Original-position fees and beneficiary claims are available in <Link href="/my-launches/earnings" prefetch={false}>Earnings</Link>. LP principal remains locked.</p>}
    {message && <p role="alert" className="lpInlineNotice">{message}</p>}
  </section>;
}
