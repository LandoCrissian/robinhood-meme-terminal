import assert from "node:assert/strict";
import { decodeEventLog, parseAbiItem, toEventSelector, type Hex } from "viem";

export const marketIntervals = [60, 300, 900, 3600, 86400] as const;
export const saleTarget = 600_000_000n * 10n ** 18n;
export const backingTarget = 2n * 10n ** 18n;
export const tradeEvent = parseAbiItem(
  "event CurveTrade(address indexed account,bool indexed isBuy,uint256 tokenAmount,uint256 grossNative,uint256 fee,uint256 nativeRefund,uint256 sold,uint256 backingReserve)",
);
export const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
);
export const graduationEvent = parseAbiItem(
  "event CurveGraduated(bytes32 indexed poolId,uint256 indexed positionTokenId,uint256 nativeUsed,uint256 tokenUsed,uint256 nativeDust,uint256 tokenDust)",
);
export const selectors = {
  curve: toEventSelector(tradeEvent),
  swap: toEventSelector(swapEvent),
  graduation: toEventSelector(graduationEvent),
};
export type MarketLog = { address: string; topics: readonly Hex[]; data: Hex };
export type MarketBinding = {
  curves: string[];
  manager: string;
  poolId: string | null;
};
export type Fill = { native: bigint; tokens: bigint };
export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeWei: string;
  count: number;
};

// The native leg is exactly what the trader paid or received, excluding refunds and gas.
export function marketFill(
  log: MarketLog,
  binding: MarketBinding,
): Fill | null {
  const topics = [...log.topics] as [Hex, ...Hex[]];
  const emitter = log.address.toLowerCase();
  if (topics[0] === selectors.curve && binding.curves.includes(emitter)) {
    const { args: t } = decodeEventLog({
      abi: [tradeEvent],
      data: log.data,
      topics,
    });
    assert.ok(
      t.tokenAmount > 0n &&
        t.grossNative > t.fee &&
        t.fee === (t.grossNative + 99n) / 100n,
    );
    assert.ok(t.sold <= saleTarget && t.backingReserve <= backingTarget);
    return {
      native: t.isBuy ? t.grossNative : t.grossNative - t.fee,
      tokens: t.tokenAmount,
    };
  }
  if (
    emitter === binding.manager &&
    topics[0] === selectors.swap &&
    topics[1] === binding.poolId
  ) {
    const { args: s } = decodeEventLog({
      abi: [swapEvent],
      data: log.data,
      topics,
    });
    assert.ok(
      s.fee === 3000 &&
        s.liquidity > 0n &&
        s.sqrtPriceX96 > 0n &&
        s.amount0 * s.amount1 < 0n,
    );
    return {
      native: s.amount0 < 0n ? -s.amount0 : s.amount0,
      tokens: s.amount1 < 0n ? -s.amount1 : s.amount1,
    };
  }
  return null;
}

// Consume canonical newest-first receipt order. Prices round only on conversion to chart coordinates.
export function addMarketFill(
  buckets: Map<number, Candle>,
  seconds: number,
  interval: number,
  fill: Fill,
) {
  const time = Math.floor(seconds / interval) * interval;
  const price = Number(fill.native) / Number(fill.tokens);
  assert.ok(
    Number.isSafeInteger(seconds) &&
      seconds > 0 &&
      price > 0 &&
      Number.isFinite(price),
  );
  const row = buckets.get(time);
  if (!row)
    buckets.set(time, {
      time,
      open: price,
      high: price,
      low: price,
      close: price,
      volumeWei: fill.native.toString(),
      count: 1,
    });
  else {
    row.open = price;
    row.high = Math.max(row.high, price);
    row.low = Math.min(row.low, price);
    row.volumeWei = (BigInt(row.volumeWei) + fill.native).toString();
    row.count++;
  }
}
