import type { FixtureLifecycle } from "../../lib/server/fixture-discovery";
import { ChainTime } from "./launch-freshness";

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
