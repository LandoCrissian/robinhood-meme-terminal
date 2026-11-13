"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { encodeFunctionData, erc20Abi, formatEther, parseEther, zeroAddress, type Address } from "viem";
import { curveReviewTime, fetchCurveState } from "../../../lib/launchpad/curve-receipt";
import { curveAbi, curveLedgerAbi, curveProjectURI, sameCurveAddress, type CurveLaunch, type CurveState } from "../../../lib/launchpad/curve-v1";
import { displayAmount, prepareSwap, prepareTransaction } from "../../../lib/launchpad/direct-v4";
import { walletMessage, type LaunchRequest } from "../../../lib/launchpad/transactions";
import { useTradingTermsAcceptance } from "../../../lib/use-trading-terms";
import { TokenArtwork } from "./launch-directory";
import { CopyIdentity } from "./launch-shell";
import { TransactionFeedback, useLaunchTransaction } from "./launch-transactions";
import { useLaunchClient, useLaunchWallet, WalletConnection } from "./launch-wallet";

type Snapshot = Awaited<ReturnType<typeof fetchCurveState>>;
type Review = {
  request: LaunchRequest; amountIn?: bigint; amountOut?: bigint; minimumOut?: bigint; nativeFee?: bigint; refund?: bigint;
  graduate?: LaunchRequest;
};
const v4Kinds = { buy: "curve-v4-buy", sell: "curve-v4-sell", "token-approval": "curve-v4-token-approval",
  "router-approval": "curve-v4-router-approval" } as const;

function parseAmount(raw: string) {
  if (!/^\d{1,12}(?:\.\d{1,18})?$/.test(raw)) throw new Error("Enter a positive amount with at most 18 decimal places.");
  const amount = parseEther(raw);
  if (amount <= 0n) throw new Error("Enter a positive amount.");
  return amount;
}

export function CurveToken({ token, initialSide }: { token: Address; initialSide: "buy" | "sell" }) {
  const { config, wallet } = useLaunchWallet();
  const enabled = config?.status === "ready" && Boolean(config.curve);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const transaction = useLaunchTransaction();
  const account = wallet?.address;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setError("");
    fetchCurveState(token, account, controller.signal).then((next) => {
      if (!controller.signal.aborted) setSnapshot(next);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setSnapshot(undefined);
        setError(walletMessage(cause));
      }
    });
    return () => controller.abort();
  }, [token, account, enabled, attempt, transaction.result]);

  return <>
    <TransactionFeedback transaction={transaction} />
    {enabled && !snapshot && !error && <p className="lpNotice" role="status">Verifying curve and liquidity evidence…</p>}
    {config && !enabled && <p className="lpNotice">Onchain curve launches are disabled on this deployment.</p>}
    {error && <div className="lpNotice lpError" role="status">{error}<button type="button" className="lpButton lpSecondary" onClick={() => setAttempt((prior) => prior + 1)}>Retry</button></div>}
    {enabled && snapshot && <CurveDetail key={snapshot.launch.token} launch={snapshot.launch} state={snapshot.state}
      initialSide={initialSide} transaction={transaction} />}
  </>;
}

function CurveDetail({ launch, state, initialSide, transaction }: {
  launch: CurveLaunch; state: CurveState; initialSide: "buy" | "sell"; transaction: ReturnType<typeof useLaunchTransaction>;
}) {
  const { config, wallet, stillSelected } = useLaunchWallet();
  const deployment = config?.status === "ready" && config.curve ? config.deployment : undefined;
  const rpc = useLaunchClient(deployment);
  const terms = useTradingTermsAcceptance();
  const [side, setSide] = useState(initialSide);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [restored, setRestored] = useState(false);
  const [review, setReview] = useState<Review>();
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const key = `rmt:curve-v1:trade:${launch.token.toLowerCase()}`;
  const sold = BigInt(state.sold);
  const threshold = BigInt(state.graduationSold);
  const progress = Number(sold * 10_000n / threshold) / 100;
  const canGraduate = !state.graduated && sold === threshold;
  const share = launch.treasuryShareBps / 100;
  const project = curveProjectURI(launch.projectURI);
  const walletConnected = Boolean(wallet && wallet.chainId === deployment?.chainId);
  const locked = preparing || transaction.busy || Boolean(transaction.pending);
  const claimable = BigInt(state.claimable ?? "0");
  const position = state.position;
  const atomicGraduation = review?.graduate;
  const canTrade = !state.graduated || Boolean(position);
  const input = side === "buy" ? "ETH" : launch.symbol;
  const output = side === "buy" ? launch.symbol : "ETH";

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { amount?: string; side?: string; slippage?: string } | null;
      if (saved?.amount && /^\d{1,12}(?:\.\d{0,18})?$/.test(saved.amount)) setAmount(saved.amount);
      if (saved?.slippage && /^\d(?:\.\d{0,2})?$/.test(saved.slippage)) setSlippage(saved.slippage);
      if (saved?.side === "buy" || saved?.side === "sell") setSide(initialSide === "sell" ? "sell" : saved.side);
    } catch { /* The form can start with defaults. */ }
    setRestored(true);
  }, [key, initialSide]);
  useEffect(() => {
    if (restored) try { localStorage.setItem(key, JSON.stringify({ amount, side, slippage })); } catch { /* Retain in-memory inputs. */ }
  }, [amount, side, slippage, key, restored]);
  useEffect(() => { setReview(undefined); }, [wallet?.generation, transaction.result, state.graduated]);

  async function prepare(kind: "trade" | "graduate" | "claim", event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!wallet || !deployment || !rpc || !walletConnected || locked || (kind === "trade" && (!terms.accepted || !canTrade))) return;
    setPreparing(true);
    setError("");
    setReview(undefined);
    try {
      const reviewedAt = await curveReviewTime(rpc);
      const deadline = reviewedAt + 300;
      const submit = (operation: Parameters<typeof prepareTransaction>[3]) => prepareTransaction(rpc, deployment, wallet, operation);
      let next: Review;
      if (kind === "graduate") {
        next = { request: await submit({ kind: "curve-graduate", token: launch.token, to: launch.curve, deadline,
          data: encodeFunctionData({ abi: curveAbi, functionName: "graduate", args: [BigInt(deadline)] }) }) };
      } else if (kind === "claim") {
        next = { request: await submit({ kind: "curve-claim", token: launch.token, to: launch.ledger, deadline,
          data: encodeFunctionData({ abi: curveLedgerAbi, functionName: "claim" }) }) };
      } else {
        const amountIn = parseAmount(amount);
        const slip = /^\d(?:\.\d{1,2})?$/.test(slippage) ? Math.round(Number(slippage) * 100) : 0;
        if (slip < 10 || slip > 500) throw new Error("Enter slippage between 0.10% and 5.00%.");
        if (position) {
          const swap = await prepareSwap(rpc, deployment, wallet, position, side, amountIn, slip, reviewedAt);
          const kind = swap.request.kind;
          if (kind !== "buy" && kind !== "sell" && kind !== "token-approval" && kind !== "router-approval") {
            throw new Error("Unexpected v4 wallet operation.");
          }
          next = { ...swap, request: { ...swap.request, kind: v4Kinds[kind] } };
        } else {
          const curve = { address: launch.curve, abi: curveAbi } as const;
          const buy = side === "buy";
          const [amountOut, , nativeFee, refund] = buy
            ? await rpc.readContract({ ...curve, functionName: "quoteBuy", args: [amountIn] })
            : await rpc.readContract({ ...curve, functionName: "quoteSell", args: [amountIn] });
          const minimumOut = amountOut * BigInt(10_000 - slip) / 10_000n;
          if (!minimumOut) throw new Error("The quoted output is too small for this trade.");
          const common = { token: launch.token, deadline, amountIn: amountIn.toString(), minimumOut: minimumOut.toString() };
          if (buy) {
            const buyRequest = (functionName: "buy" | "buyAndGraduate") => submit({ ...common, kind: "curve-buy", to: launch.curve, value: amountIn,
              data: encodeFunctionData({ abi: curveAbi, functionName, args: [minimumOut, BigInt(deadline)] }) });
            const request = await buyRequest("buy");
            const graduate = sold + amountOut === threshold ? await buyRequest("buyAndGraduate").catch(() => undefined) : undefined;
            next = { request, amountIn, amountOut, minimumOut, nativeFee, refund, graduate };
          } else {
            const [balance, allowance] = await Promise.all([
              rpc.readContract({ address: launch.token, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address] }),
              rpc.readContract({ address: launch.token, abi: erc20Abi, functionName: "allowance", args: [wallet.address, launch.curve] }),
            ]);
            if (balance < amountIn) throw new Error("Insufficient token balance for this sell.");
            const request = allowance === amountIn
              ? await submit({ ...common, kind: "curve-sell", to: launch.curve,
                data: encodeFunctionData({ abi: curveAbi, functionName: "sell", args: [amountIn, minimumOut, BigInt(deadline)] }) })
              : await submit({ ...common, kind: "curve-approval", to: launch.token,
                data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [launch.curve, amountIn] }) });
            next = { request, amountIn, amountOut, minimumOut, nativeFee };
          }
        }
      }
      if (!stillSelected(wallet)) throw new Error("Wallet selection changed. Review the action again.");
      setReview(next);
    } catch (cause) { setError(walletMessage(cause)); }
    finally { setPreparing(false); }
  }

  const action = review?.request.kind;
  const confirm = action === "curve-approval" ? "Confirm curve allowance"
    : action === "curve-v4-token-approval" ? "Confirm token approval" : action === "curve-v4-router-approval" ? "Confirm router approval"
      : action === "curve-graduate" ? "Confirm graduation in wallet" : action === "curve-claim" ? "Confirm fee claim in wallet" : `Confirm ${side} in wallet`;
  return <>
    <header className="lpPageHeading"><div className="lpTokenHeading"><TokenArtwork symbol={launch.symbol} /><div>
      <h1>{launch.name}</h1><p>{launch.symbol}</p></div></div>
      <span className="lpPill">{position ? "Uniswap v4" : state.graduated ? "Verifying graduation" : "Bonding curve"}</span>
    </header>
    <div className="lpColumns">
      <section className="lpPanel lpForm">
        <h2>Launch evidence</h2>
        <dl className="lpFacts">
          <dt>Fixed supply</dt><dd>{displayAmount(launch.totalSupply)} {launch.symbol}</dd>
          <dt>Creator token allocation</dt><dd>0 {launch.symbol}</dd>
          <dt>Net curve tokens sold</dt><dd>{displayAmount(sold)} of {displayAmount(threshold)}</dd>
          <dt>Curve backing reserve</dt><dd>{displayAmount(state.backingReserve)} ETH</dd>
          <dt>Graduation progress</dt><dd>{progress.toFixed(2)}%</dd>
          <dt>Curve trading fee</dt><dd>1% of gross ETH</dd>
          <dt>Collected fee allocation</dt><dd>{90 - share}% creator · {share}% project treasury · 5% RMT operating · 5% future RMT reserve</dd>
          <dt>Token contract</dt><dd><CopyIdentity title="token contract" value={launch.token} /></dd>
          <dt>Curve contract</dt><dd><CopyIdentity title="curve contract" value={launch.curve} /></dd>
          <dt>Creation transaction</dt><dd><CopyIdentity title="creation transaction" value={launch.transactionHash} /></dd>
          <dt>Observed block</dt><dd>{state.blockNumber} · L1 finality unverified</dd>
          {project && <><dt>Project</dt><dd><a href={project} target="_blank" rel="noreferrer">Open project website</a></dd></>}
          {position && <>
            <dt>Locked v4 deposits</dt><dd>{displayAmount(position.amount0)} ETH · {displayAmount(position.amount1)} {launch.symbol}</dd>
            <dt>Permanent position</dt><dd>#{position.positionTokenId} · liquidity {position.liquidity}</dd>
            <dt>Position custody</dt><dd><CopyIdentity title="position owner" value={state.positionOwner!} /></dd>
            <dt>PoolManager</dt><dd><CopyIdentity title="PoolManager" value={position.poolManager} /></dd>
            <dt>PoolId</dt><dd><CopyIdentity title="PoolId" value={position.poolId} /></dd>
            <dt>Initialization guard</dt><dd><CopyIdentity title="initialization guard" value={position.poolKey.hooks} /></dd>
            <dt>Graduation transaction</dt><dd><CopyIdentity title="graduation transaction" value={position.transactionHash} /></dd>
          </>}
        </dl>
        <details>
          <summary>Verified curve revenue</summary>
          <dl className="lpFacts">
            <dt>Revenue ledger</dt><dd><CopyIdentity title="revenue ledger" value={launch.ledger} /></dd>
            <dt>Creator accrued</dt><dd>{displayAmount(state.bucketAccrued[0])} ETH</dd>
            <dt>Treasury accrued</dt><dd>{displayAmount(state.bucketAccrued[1])} ETH</dd>
            <dt>RMT operating accrued</dt><dd>{displayAmount(state.bucketAccrued[2])} ETH</dd>
            <dt>Future RMT reserve accrued</dt><dd>{displayAmount(state.bucketAccrued[3])} ETH</dd>
            <dt>Total collected</dt><dd>{displayAmount(state.totalAccrued)} ETH</dd>
            <dt>Total claimed</dt><dd>{displayAmount(state.totalClaimed)} ETH</dd>
          </dl>
        </details>
        <details>
          <summary>Project version and migrations</summary>
          {state.project ? <dl className="lpFacts">
            <dt>Permanent registry</dt><dd><CopyIdentity title="project registry" value={state.project.registry} /></dd>
            <dt>Active version</dt><dd>Version {state.project.currentVersion}</dd>
            <dt>Execution engine</dt><dd><CopyIdentity title="execution engine" value={state.project.currentEngine} /></dd>
            <dt>Economic rules commitment</dt><dd><CopyIdentity title="economic rules commitment" value={state.project.economicRules} /></dd>
            <dt>Recorded migrations</dt><dd>{state.project.count}</dd>
            {state.project.pending && <>
              <dt>Proposed engine</dt><dd><CopyIdentity title="proposed execution engine" value={state.project.pending.nextEngine} /></dd>
              <dt>Proposed runtime</dt><dd><CopyIdentity title="proposed runtime hash" value={state.project.pending.runtimeHash} /></dd>
              <dt>Executable after</dt><dd>{state.project.pending.executableAt ? new Date(state.project.pending.executableAt * 1_000).toISOString() : "Awaiting signer approvals"}</dd>
              <dt>Expires</dt><dd>{new Date((state.project.pending.expiresAt || state.project.pending.deadline) * 1_000).toISOString()}</dd>
            </>}
            {state.project.migrations.map((migration) => <div className="lpMigration" key={migration.index}>
              <dt>Version {migration.fromVersion} to {migration.toVersion}</dt><dd>Block {migration.blockNumber}</dd>
              <dt>Previous engine</dt><dd><CopyIdentity title="previous execution engine" value={migration.previousEngine} /></dd>
              <dt>Next engine</dt><dd><CopyIdentity title="next execution engine" value={migration.nextEngine} /></dd>
              <dt>Runtime hash</dt><dd><CopyIdentity title="execution runtime hash" value={migration.runtimeHash} /></dd>
            </div>)}
          </dl> : <p>Registry evidence is unavailable for this review deployment.</p>}
        </details>
        {position && <p>The standard v4 LP fee is 0.30%. This version leaves fees earned by the locked position in custody. Outside liquidity and routing depend on the venue.</p>}
        {canGraduate && <button className="lpButton" type="button" disabled={locked || !walletConnected} onClick={() => void prepare("graduate")}>Review graduation</button>}
        {wallet && <div className="lpForm">
          <h3>Your curve revenue</h3><p>{state.claimable === null ? "Claim evidence is unavailable." : `${displayAmount(claimable)} ETH claimable`}</p>
          {claimable > 0n && <button className="lpButton lpSecondary" type="button" disabled={locked || !walletConnected} onClick={() => void prepare("claim")}>Review fee claim</button>}
        </div>}
      </section>
      <section className="lpPanel lpForm lpTradeColumn">
        <h2>{position ? "Trade on Uniswap v4" : `Trade ${launch.symbol}`}</h2>
        {!walletConnected && <WalletConnection compact />}
        {!canTrade && <p className="lpNotice" role="status">Graduation was observed. Trading waits for canonical funding and custody verification.</p>}
        {canTrade && <>
          <div className="lpTabs" aria-label="Trade direction">
            {(["buy", "sell"] as const).map((option) => <button key={option} className={side === option ? "isActive" : undefined}
              type="button" disabled={locked} aria-pressed={side === option} onClick={() => { setSide(option); setReview(undefined); }}>
              {option === "buy" ? "Buy" : "Sell"}
            </button>)}
          </div>
          <form className="lpForm" onSubmit={(event) => void prepare("trade", event)}>
            <fieldset disabled={locked}>
              <label>You pay ({input})<input required inputMode="decimal" maxLength={32} value={amount}
                onChange={(event) => { setAmount(event.target.value); setReview(undefined); }} /></label>
              <label>Slippage (%)<input required inputMode="decimal" maxLength={4} value={slippage}
                onChange={(event) => { setSlippage(event.target.value); setReview(undefined); }} /></label>
            </fieldset>
            {terms.ready && !terms.accepted && <label className="lpCheck">
              <input type="checkbox" onChange={(event) => { if (event.target.checked) terms.accept(); }} />
              <span>I accept the <Link href="/terms" target="_blank">trading terms</Link> and <Link href="/risks" target="_blank">risks</Link>.</span>
            </label>}
            <button className="lpButton" disabled={locked || !walletConnected || !terms.accepted || (!position && canGraduate && side === "buy")}>
              {preparing ? "Checking quote and simulation…" : "Review trade"}
            </button>
          </form>
        </>}
        {error && <p className="lpNotice lpError" role="alert">{error}</p>}
        {review && <div className="lpForm lpReview">
          <dl className="lpFacts">
            {review.amountIn !== undefined && <><dt>{side === "buy" && !position ? "Maximum input" : "Exact input"}</dt><dd>{formatEther(review.amountIn)} {input}</dd></>}
            {review.amountOut !== undefined && <><dt>Estimated output</dt><dd>{displayAmount(review.amountOut)} {output}</dd></>}
            {review.minimumOut !== undefined && <><dt>Minimum output</dt><dd>{formatEther(review.minimumOut)} {output}</dd></>}
            {review.nativeFee !== undefined && <><dt>Estimated curve fee</dt><dd>{formatEther(review.nativeFee)} ETH</dd></>}
            {review.refund !== undefined && review.refund > 0n && <><dt>Estimated unspent ETH refund</dt><dd>{formatEther(review.refund)} ETH</dd></>}
            {action === "curve-graduate" && <><dt>Graduation</dt><dd>Use the existing token and backing reserve to fund the canonical locked v4 position.</dd></>}
            {action === "curve-claim" && <><dt>Available fees</dt><dd>{displayAmount(claimable)} ETH</dd></>}
            <dt>Wallet</dt><dd className="lpAddress">{review.request.from}</dd>
            <dt>Expires</dt><dd>{new Date(review.request.deadline * 1_000).toLocaleTimeString()}</dd>
          </dl>
          {(action === "curve-approval" || action === "curve-v4-token-approval" || action === "curve-v4-router-approval") && <p>Approve only the reviewed amount. Review the sale again after approval confirms.</p>}
          <button className="lpButton" type="button" disabled={locked} onClick={() => void transaction.send(review.request)}>{confirm}</button>
          {atomicGraduation && <button className="lpButton lpSecondary" type="button" disabled={locked}
            onClick={() => void transaction.send(atomicGraduation)}>Confirm buy and graduate in wallet</button>}
        </div>}
      </section>
    </div>
  </>;
}
