import type { FixtureLifecycle } from "../../lib/server/fixture-discovery";
import { ChainTime } from "./launch-freshness";

const postEventLabel = { "v4-buy": "v4 buy", "v4-sell": "v4 sell", "lp-collect": "LP fee collection", "lp-claim": "LP fee claim" };
const feeRoleLabel = { creator: "Creator", treasury: "Project treasury", operations: "Protocol operations", reserve: "Future reserve" };

export function formatTestAmount(value: string | bigint) {
  const amount = BigInt(value);
  const whole = (amount / 10n ** 18n).toLocaleString("en-US");
  const fraction = (amount % (10n ** 18n)).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function formatTestPercent(basisPoints: number | bigint) {
  const value = BigInt(basisPoints);
  const fraction = (value % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return `${value / 100n}${fraction ? `.${fraction}` : ""}%`;
}

function assetAmounts(amounts: { nativeWei: string; tokenWei: string }, symbol: string) {
  return `${formatTestAmount(amounts.nativeWei)} test ETH · ${formatTestAmount(amounts.tokenWei)} ${symbol}`;
}

function PostGraduationEvidence({ evidence, observed, symbol }: {
  evidence: NonNullable<FixtureLifecycle["postGraduation"]>; observed: FixtureLifecycle["observed"]; symbol: string;
}) {
  return <section className="lpPanel lpForm">
    <h2>Canonical Uniswap v4 and LP fee activity</h2>
    <p>Verified through block {observed.blockNumber} · <ChainTime value={observed.timestamp} /> · Ethereum L1 finality unverified</p>
    <dl className="lpFacts">
      <dt>Uncollected fees observed</dt><dd>{assetAmounts(evidence.uncollected, symbol)}</dd>
      <dt>Total credited by collection</dt><dd>{assetAmounts(evidence.accrued, symbol)}</dd>
      <dt>Total disbursed by claim</dt><dd>{assetAmounts(evidence.claimed, symbol)}</dd>
      <dt>Observed ledger balance</dt><dd>{assetAmounts(evidence.balances, symbol)}</dd>
      <dt>LP fee ledger</dt><dd><code className="lpAddress">{evidence.ledger}</code></dd>
    </dl>
    <details>
      <summary>Verified beneficiary credits</summary>
      <dl className="lpFacts">
        {evidence.beneficiaries.map((row) => <div className="lpDraftField" key={row.address}>
          <dt>{row.roles.map((role) => feeRoleLabel[role]).join(" · ")}</dt>
          <dd><code className="lpAddress">{row.address}</code></dd>
          <dt>Claimable credit</dt><dd>{assetAmounts(row.claimable, symbol)}</dd>
        </div>)}
      </dl>
    </details>
    {evidence.events.length ? <ol className="lpChecks">{evidence.events.map((event) => <li key={`${event.transactionHash}:${event.logIndex}`}>
      <details>
        <summary>{postEventLabel[event.kind]} · {assetAmounts(event, symbol)}</summary>
        <dl className="lpFacts">
          <dt>{event.kind === "lp-claim" ? "Beneficiary" : "Submitting account"}</dt><dd><code className="lpAddress">{event.account}</code></dd>
          {event.feePips !== undefined && <><dt>Observed pool fee rate</dt><dd>{formatTestPercent(BigInt(event.feePips) / 100n)}</dd></>}
          <dt>Receipt block</dt><dd>{event.blockNumber} · log {event.logIndex} · <ChainTime value={event.timestamp} /></dd>
          <dt>Receipt transaction</dt><dd><code className="lpAddress">{event.transactionHash}</code></dd>
        </dl>
      </details>
    </li>)}</ol> : <p>No verified v4 swaps, fee collections or claims at this checkpoint.</p>}
  </section>;
}

export function FixtureLifecycleEvidence({ lifecycle, symbol }: { lifecycle: FixtureLifecycle; symbol: string }) {
  const closed = lifecycle.graduation;
  return <>
    {closed && <section className="lpPanel lpForm">
      <h2>Verified Uniswap v4 graduation</h2>
      <p>Original liquidity is permanently locked. Curve buying and selling are closed.</p>
      <dl className="lpFacts">
        <dt>Locked native deposit</dt><dd>{formatTestAmount(closed.nativeUsedWei)} test ETH</dd>
        <dt>Locked token deposit</dt><dd>{formatTestAmount(closed.tokenUsedWei)} {symbol}</dd>
        <dt>Position NFT</dt><dd>#{closed.positionTokenId}</dd>
        <dt>Locked position liquidity</dt><dd>{closed.liquidityWei}</dd>
        <dt>Custody owner</dt><dd><code className="lpAddress">{closed.owner}</code></dd>
        <dt>Pool ID</dt><dd><code className="lpAddress">{closed.poolId}</code></dd>
        <dt>Native rounding dust</dt><dd>{formatTestAmount(closed.nativeDustWei)} test ETH</dd>
        <dt>Token rounding dust</dt><dd>{formatTestAmount(closed.tokenDustWei)} {symbol}</dd>
        <dt>Graduation block</dt><dd>{closed.blockNumber} · log {closed.logIndex}</dd>
        <dt>Graduation transaction</dt><dd><code className="lpAddress">{closed.transactionHash}</code></dd>
      </dl>
      <details>
        <summary>Full verified PoolKey and custody bindings</summary>
        <dl className="lpFacts">
          <dt>Currency 0</dt><dd><code className="lpAddress">{closed.poolKey.currency0}</code> · native test ETH</dd>
          <dt>Currency 1</dt><dd><code className="lpAddress">{closed.poolKey.currency1}</code></dd>
          <dt>Pool fee</dt><dd>{formatTestPercent(BigInt(closed.poolKey.fee) / 100n)}</dd>
          <dt>Tick spacing</dt><dd>{closed.poolKey.tickSpacing}</dd>
          <dt>Initialization guard</dt><dd><code className="lpAddress">{closed.poolKey.hooks}</code></dd>
          <dt>PoolManager</dt><dd><code className="lpAddress">{closed.poolManager}</code></dd>
          <dt>PositionManager</dt><dd><code className="lpAddress">{closed.positionManager}</code></dd>
          <dt>Opening square-root price Q96</dt><dd>{closed.sqrtPriceX96}</dd>
          <dt>Observed square-root price Q96</dt><dd>{closed.spotSqrtPriceX96 ?? "Unavailable"}</dd>
          <dt>Observed pool tick</dt><dd>{closed.spotTick ?? "Unavailable"}</dd>
          <dt>Observed active pool liquidity</dt><dd>{closed.poolLiquidityWei ?? "Unavailable"}</dd>
          <dt>Pool observation block</dt><dd>{lifecycle.observed.blockNumber} · <ChainTime value={lifecycle.observed.timestamp} /></dd>
          <dt>Graduation block hash</dt><dd><code className="lpAddress">{closed.blockHash}</code></dd>
        </dl>
      </details>
    </section>}
    {closed && lifecycle.postGraduation && <PostGraduationEvidence evidence={lifecycle.postGraduation} observed={lifecycle.observed} symbol={symbol} />}
    <section className="lpPanel lpForm">
      <h2>Canonical trading activity</h2>
      <p>Verified through block {lifecycle.observed.blockNumber} · <ChainTime value={lifecycle.observed.timestamp} /> · Ethereum L1 finality unverified</p>
      {lifecycle.trades.length ? <ol className="lpChecks">{[...lifecycle.trades].reverse().map((trade) => {
        const netNative = trade.side === "sell" ? BigInt(trade.nativeWei) - BigInt(trade.feeWei) : BigInt(trade.nativeWei);
        return <li key={`${trade.transactionHash}:${trade.logIndex}`}>
          <details>
            <summary>{trade.side === "buy" ? "Buy" : "Sell"} · {formatTestAmount(trade.tokenWei)} {symbol} · {formatTestAmount(netNative)} test ETH</summary>
            <dl className="lpFacts">
              <dt>Trader</dt><dd><code className="lpAddress">{trade.account}</code></dd>
              <dt>Fee</dt><dd>{formatTestAmount(trade.feeWei)} test ETH</dd>
              {trade.nativeRefundWei !== "0" && <><dt>Verified refund</dt><dd>{formatTestAmount(trade.nativeRefundWei)} test ETH</dd></>}
              <dt>Curve backing after trade</dt><dd>{formatTestAmount(trade.backingWei)} test ETH</dd>
              <dt>Receipt block</dt><dd>{trade.blockNumber} · log {trade.logIndex}</dd>
              <dt>Receipt transaction</dt><dd><code className="lpAddress">{trade.transactionHash}</code></dd>
            </dl>
          </details>
        </li>;
      })}</ol> : <p>No verified curve trades at this checkpoint.</p>}
    </section>
  </>;
}
