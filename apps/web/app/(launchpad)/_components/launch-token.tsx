"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { encodeFunctionData, formatEther, parseEther, type Address } from "viem";
import { displayAmount, factoryAbi, prepareSwap, prepareTransaction, priceInWei, readTradeHistory, type SwapReview } from "../../../lib/launchpad/direct-v4";
import type { NewLaunchRecord } from "../../../lib/launchpad/launch-record";
import { walletMessage, type LaunchRequest } from "../../../lib/launchpad/transactions";
import { useTradingTermsAcceptance } from "../../../lib/use-trading-terms";
import { PriceHistoryChart, type PricePoint } from "../../price-history-chart";
import { TokenArtwork } from "./launch-directory";
import { CopyIdentity } from "./launch-shell";
import { TransactionFeedback, useLaunches, useLaunchTransaction } from "./launch-transactions";
import { useLaunchClient, useLaunchWallet, WalletConnection } from "./launch-wallet";

function tradeAmount(value: string) {
  if (!/^\d{1,12}(?:\.\d{1,18})?$/.test(value)) throw new Error("Enter a positive amount with at most 18 decimal places.");
  const amount = parseEther(value);
  if (amount <= 0n) throw new Error("Enter a positive amount.");
  return amount;
}

function TradePanel({ launch, transaction, initialSide }: {
  launch: NewLaunchRecord;
  transaction: ReturnType<typeof useLaunchTransaction>;
  initialSide: "buy" | "sell";
}) {
  const { config, wallet, stillSelected } = useLaunchWallet();
  const deployment = config?.status === "ready" ? config.deployment : undefined;
  const client = useLaunchClient(deployment);
  const terms = useTradingTermsAcceptance();
  const [side, setSide] = useState(initialSide);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [review, setReview] = useState<SwapReview>();
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [restored, setRestored] = useState(false);
  const key = `rmt:launchpad:trade:v1:${launch.chainId}:${launch.token.toLowerCase()}`;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { side?: string; amount?: string; slippage?: string } | null;
      if (saved?.amount && /^\d{1,12}(?:\.\d{0,18})?$/.test(saved.amount)) setAmount(saved.amount);
      if (saved?.slippage && /^\d{1,2}(?:\.\d{0,2})?$/.test(saved.slippage)) setSlippage(saved.slippage);
      if (saved?.side === "buy" || saved?.side === "sell") setSide(initialSide === "sell" ? "sell" : saved.side);
    } catch { /* The trade form can start empty. */ }
    setRestored(true);
  }, [key, initialSide]);
  useEffect(() => {
    if (restored) try { localStorage.setItem(key, JSON.stringify({ side, amount, slippage })); } catch { /* Keep the current form in memory. */ }
  }, [key, side, amount, slippage, restored]);
  useEffect(() => { setReview(undefined); }, [wallet?.generation, transaction.result]);

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !deployment || !wallet || preparing || transaction.pending || !terms.accepted) return;
    setReview(undefined);
    setError("");
    setPreparing(true);
    try {
      if (!/^\d(?:\.\d{1,2})?$/.test(slippage)) throw new Error("Enter slippage to two decimal places.");
      const next = await prepareSwap(client, deployment, wallet, launch, side, tradeAmount(amount), Math.round(Number(slippage) * 100));
      if (!stillSelected(wallet)) throw new Error("Wallet selection changed. Review the trade again.");
      setReview(next);
    } catch (cause) {
      setError(walletMessage(cause));
    } finally {
      setPreparing(false);
    }
  }

  if (!deployment?.tradingEnabled) return <section className="lpPanel lpForm"><h2>Trade</h2><p>Direct trading is disabled in this environment.</p></section>;
  const wrongNetwork = Boolean(wallet && wallet.chainId !== deployment.chainId);
  const locked = preparing || transaction.busy || Boolean(transaction.pending);
  const action = review?.request.kind;
  const output = side === "buy" ? launch.symbol : "ETH";
  const input = side === "buy" ? "ETH" : launch.symbol;
  return <section className="lpPanel lpForm">
    <h2>Trade {launch.symbol}</h2>
    <div className="lpTabs" aria-label="Trade direction">
      {(["buy", "sell"] as const).map((option) => <button className={side === option ? "isActive" : undefined} key={option}
        type="button" aria-pressed={side === option} disabled={locked} onClick={() => { setSide(option); setReview(undefined); }}>{option === "buy" ? "Buy" : "Sell"}</button>)}
    </div>
    <form className="lpForm" onSubmit={(event) => void prepare(event)}>
      <fieldset disabled={locked}>
        <label>You pay ({input})<input required value={amount} onChange={(event) => { setAmount(event.target.value); setReview(undefined); }}
          inputMode="decimal" placeholder="0.00" maxLength={32} /></label>
        <label>Slippage (%)<input required value={slippage} onChange={(event) => { setSlippage(event.target.value); setReview(undefined); }}
          inputMode="decimal" maxLength={4} /><small>0.10–5.00%</small></label>
      </fieldset>
      {(!wallet || wrongNetwork) && <WalletConnection compact />}
      {terms.ready && !terms.accepted && <label className="lpCheck">
        <input type="checkbox" onChange={(event) => { if (event.target.checked) terms.accept(); }} />
        <span>I accept the <Link href="/terms" target="_blank">trading terms</Link> and <Link href="/risks" target="_blank">risks</Link>.</span>
      </label>}
      {error && <p className="lpNotice lpError" role="alert">{error}</p>}
      <button className="lpButton" disabled={locked || !wallet || wrongNetwork || !terms.accepted}>
        {preparing ? "Checking quote and simulation…" : review ? "Refresh review" : "Review trade"}
      </button>
    </form>
    {review && <div className="lpForm lpReview">
      <dl className="lpFacts">
        <dt>Exact input</dt><dd>{formatEther(review.amountIn)} {input}</dd>
        <dt>Estimated output</dt><dd>{displayAmount(review.amountOut)} {output}</dd>
        <dt>Minimum output</dt><dd>{formatEther(review.minimumOut)} {output}</dd>
        <dt>Pool fee</dt><dd>0.30% + network gas</dd>
        <dt>Recipient</dt><dd className="lpAddress">{review.request.from}</dd>
        <dt>Expires</dt><dd>{new Date(review.deadline * 1000).toLocaleTimeString()}</dd>
      </dl>
      {action === "token-approval" && <p>Approve exactly {formatEther(review.amountIn)} {launch.symbol} for Permit2. This token approval remains until spent or revoked.</p>}
      {action === "router-approval" && <p>Allow the pinned Uniswap router to use exactly {displayAmount(review.amountIn)} {launch.symbol} through Permit2 for up to five minutes.</p>}
      <button className="lpButton" type="button" disabled={locked} onClick={() => void transaction.send(review.request)}>
        {action === "token-approval" ? "Confirm token approval" : action === "router-approval" ? "Confirm router approval" : `Confirm ${side} in wallet`}
      </button>
    </div>}
  </section>;
}

function FeeClaim({ launch, transaction }: { launch: NewLaunchRecord; transaction: ReturnType<typeof useLaunchTransaction> }) {
  const { config, wallet, stillSelected } = useLaunchWallet();
  const deployment = config?.status === "ready" ? config.deployment : undefined;
  const client = useLaunchClient(deployment);
  const [review, setReview] = useState<LaunchRequest>();
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  useEffect(() => setReview(undefined), [wallet?.generation, transaction.result]);
  if (!wallet || !deployment || !client || wallet.address.toLowerCase() !== launch.creator.toLowerCase()) return null;
  const activeWallet = wallet;
  const activeDeployment = deployment;
  const rpc = client;

  async function prepare() {
    setPreparing(true);
    setError("");
    try {
      const deadline = Math.floor(Date.now() / 1000) + 5 * 60;
      const data = encodeFunctionData({ abi: factoryAbi, functionName: "collectFees", args: [launch.token, BigInt(deadline)] });
      const request = await prepareTransaction(rpc, activeDeployment, activeWallet, {
        kind: "fees", to: activeDeployment.factory, data, deadline, token: launch.token,
      });
      if (!stillSelected(activeWallet)) throw new Error("Wallet selection changed. Review fees again.");
      setReview(request);
    } catch (cause) {
      setError(walletMessage(cause));
    } finally {
      setPreparing(false);
    }
  }

  return <section className="lpPanel lpForm">
    <h2>Creator fees</h2>
    <p>Collect any accrued position fees to the creator wallet. Principal stays in the locked position. Network gas applies even if the claim is zero.</p>
    {error && <p className="lpNotice lpError" role="alert">{error}</p>}
    <button className="lpButton" type="button" disabled={preparing || transaction.busy || Boolean(transaction.pending)}
      onClick={() => void (review ? transaction.send(review) : prepare())}>
      {preparing ? "Simulating claim…" : review ? "Confirm fee claim in wallet" : "Review fee claim"}
    </button>
  </section>;
}

type Check = { id: string; label: string; status: "verified" | "failed" | "unknown" | "unsupported"; detail: string };
function LaunchChecks({ launch }: { launch: NewLaunchRecord }) {
  const [checks, setChecks] = useState<Check[]>();
  const [status, setStatus] = useState("loading");
  const [evidence, setEvidence] = useState<{ blockNumber?: string; freshness?: string }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ chainId: String(launch.chainId), token: launch.token });
    fetch(`/api/launchpad/public/get_launch_checks?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const value = await response.json() as { status: string; data?: { checks?: Check[]; evidence?: { blockNumber?: string; freshness?: string } } };
        if (!controller.signal.aborted) {
          setChecks(value.data?.checks);
          setStatus(value.status);
          setEvidence(value.data?.evidence);
        }
      }).catch(() => { if (!controller.signal.aborted) setStatus("delayed"); });
    return () => controller.abort();
  }, [launch.chainId, launch.token, attempt]);
  return <section className="lpPanel lpForm">
    <h2>Launch checks</h2>
    {status === "loading" && <p role="status">Checking onchain evidence…</p>}
    {!checks && status !== "loading" && <div className="lpNotice">Checks unavailable.
      <button className="lpButton lpSecondary" type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>}
    {checks && <ul className="lpChecks">
      {checks.map((check) => <li key={check.id}>
        <div><strong>{check.label}</strong><span className={`lpCheckState lp-${check.status}`}>{check.status}</span></div>
        <p>{check.detail}</p>
      </li>)}
    </ul>}
    {evidence?.blockNumber && <p>Evidence block {evidence.blockNumber} · {evidence.freshness ?? "Freshness unknown"}</p>}
    <a className="lpBack" href={`/api/launchpad/public/get_launch_checks?chainId=${launch.chainId}&token=${launch.token}`} target="_blank" rel="noreferrer">Open evidence JSON ↗</a>
    <p>These checks describe launch evidence and custody rules. Market risk and outside routing can change.</p>
  </section>;
}

function TokenHistory({ launch, refresh }: { launch: NewLaunchRecord; refresh?: string }) {
  const { config } = useLaunchWallet();
  const client = useLaunchClient(config?.status === "ready" ? config.deployment : undefined);
  const [history, setHistory] = useState<PricePoint[]>();
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void readTradeHistory(client, launch).then((points) => { if (!cancelled) { setHistory(points); setError(false); } })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [client, launch, refresh]);
  return <section className="lpPanel lpChart">
    {error ? <p role="status">Recent price history is unavailable.</p> : !history ? <p role="status">Loading recent pool activity…</p>
      : <PriceHistoryChart points={history} symbol={launch.symbol} quoteAsset="ETH" />}
  </section>;
}

function projectLink(value: string) {
  try {
    const link = new URL(value);
    if (link.protocol === "https:" && !link.username && !link.password) return link.href;
  } catch { /* Arbitrary onchain bytes are displayed as text only. */ }
}

function VerifiedToken({ launch, initialSide }: { launch: NewLaunchRecord; initialSide: "buy" | "sell" }) {
  const { config } = useLaunchWallet();
  const transaction = useLaunchTransaction(launch);
  const trading = config?.status === "ready" && config.deployment.tradingEnabled;
  const project = projectLink(launch.projectURI);
  return <>
    <Link className="lpBack" href="/">← Launches</Link>
    <header className="lpPageHeading">
      <div className="lpTokenHeading"><TokenArtwork symbol={launch.symbol} /><div><h1>{launch.name}</h1><p>{launch.symbol} · Uniswap v4</p></div></div>
      <span className="lpPill">Funded pool verified</span>
    </header>
    <TransactionFeedback transaction={transaction} />
    <div className="lpColumns lpTokenColumns">
      <div className="lpStack">
        <TokenHistory launch={launch} refresh={transaction.result?.hash} />
        <section className="lpPanel lpForm">
          <h2>Launch details</h2>
          <dl className="lpFacts">
            <dt>Onchain status</dt><dd>Confirmed in block {launch.blockNumber}</dd>
            <dt>Directory</dt><dd>{launch.indexing === "indexed" ? "Indexed" : "Indexing pending"}</dd>
            <dt>RMT trading</dt><dd>{trading ? "Available on the local fork" : "Disabled"}</dd>
            <dt>External indexing / routing</dt><dd>Unknown</dd>
            <dt>Fixed supply</dt><dd>{displayAmount(launch.totalSupply)} {launch.symbol}</dd>
            <dt>Initial pool deposit</dt><dd>{displayAmount(launch.amount0)} ETH + {displayAmount(launch.amount1)} {launch.symbol}</dd>
            <dt>Creator allocation</dt><dd>{displayAmount(BigInt(launch.totalSupply) - BigInt(launch.amount1))} {launch.symbol}</dd>
            <dt>Opening price</dt><dd>{displayAmount(priceInWei(BigInt(launch.sqrtPriceX96)))} ETH</dd>
            <dt>Pool swap fee</dt><dd>0.30%</dd>
            <dt>Position</dt><dd>#{launch.positionTokenId} · Permanent custody</dd>
          </dl>
          {launch.projectURI && <p className="lpProjectLink">Project link {project
            ? <a href={project} target="_blank" rel="noopener noreferrer">{new URL(project).hostname} ↗</a>
            : <span>Unavailable</span>}</p>}
          <details><summary>Contract and pool evidence</summary>
            <dl className="lpFacts">
              <dt>Chain</dt><dd>{launch.chainId}</dd>
              <dt>Token</dt><dd><CopyIdentity title="token address" value={launch.token} /></dd>
              <dt>Creator</dt><dd><CopyIdentity title="creator address" value={launch.creator} /></dd>
              <dt>Factory / position owner</dt><dd><CopyIdentity title="factory address" value={launch.factory} /></dd>
              <dt>PoolManager</dt><dd><CopyIdentity title="PoolManager address" value={launch.poolManager} /></dd>
              <dt>PoolId</dt><dd><CopyIdentity title="PoolId" value={launch.poolId} /></dd>
              <dt>PoolKey</dt><dd>Native ETH · {launch.symbol} · fee {launch.poolKey.fee} · tick spacing {launch.poolKey.tickSpacing} · no hook</dd>
              <dt>Position ticks</dt><dd>{launch.tickLower} to {launch.tickUpper}</dd>
              <dt>Transaction</dt><dd><CopyIdentity title="transaction hash" value={launch.transactionHash} /></dd>
            </dl>
          </details>
        </section>
        <LaunchChecks launch={launch} />
      </div>
      <div className="lpStack lpTradeColumn"><TradePanel launch={launch} transaction={transaction} initialSide={initialSide} /><FeeClaim launch={launch} transaction={transaction} /></div>
    </div>
  </>;
}

export function LaunchTokenDetail({ token, side }: { token: Address; side: "buy" | "sell" }) {
  const { state, reload } = useLaunches({ token });
  const launch = state?.launches.find((entry) => entry.token.toLowerCase() === token.toLowerCase());
  if (launch) return <VerifiedToken key={launch.token} launch={launch} initialSide={side} />;
  return <>
    <Link className="lpBack" href="/">← Launches</Link>
    <header className="lpPageHeading"><div><h1>Token launch</h1><p className="lpAddress">{token}</p></div></header>
    {!state && <p role="status" className="lpNotice">Checking the launch directory…</p>}
    {state?.status === "disabled" && <p className="lpNotice">The onchain directory is disabled in this preview.</p>}
    {state && state.status !== "disabled" && <div className="lpNotice" role="status">
      <span>{state.status === "delayed" ? "Indexing is delayed. If you sent a launch, recover it with the original wallet." : "No verified launch was found for this contract."}</span>
      <button className="lpButton lpSecondary" type="button" onClick={reload}>Check again</button>
      <Link href="/wallet">Recover a transaction</Link>
    </div>}
  </>;
}
