import { productionTradingPins } from "./production-lifecycle";
export const marketIntervals = [60, 300, 900, 3600, 86400] as const;
export const intervalNames = ["1m", "5m", "15m", "1h", "1d"];
export const maxSold = 600_000_000n * 10n ** 18n;
export const ethTarget = 2n * 10n ** 18n;
export type MarketCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeWei: string;
  count: number;
};
export type MarketSnapshot = {
  token: string;
  factory: string;
  checkpoint: { blockNumber: string; blockHash: string; timestamp: string };
  soldWei: string;
  backingWei: string;
  phase: "curve" | "eligible" | "graduated";
  graduation: null | { time: number; poolId: string; nativeUsedWei: string };
  interval: number;
  candles: MarketCandle[];
  earlier: boolean;
};
const uint = (x: unknown): x is string =>
  typeof x === "string" && /^(0|[1-9][0-9]{0,77})$/.test(x);
const hash = (x: unknown) =>
  typeof x === "string" && /^0x[0-9a-f]{64}$/i.test(x);
export function validMarket(
  value: unknown,
  token: string,
  interval: number,
): value is MarketSnapshot {
  if (!value || typeof value !== "object") return false;
  const m = value as MarketSnapshot,
    block = m.checkpoint;
  if (
    m.token !== token.toLowerCase() ||
    m.factory?.toLowerCase() !== productionTradingPins.factory.toLowerCase() ||
    m.interval !== interval ||
    !marketIntervals.some((n) => n === interval) ||
    !block ||
    !uint(block.blockNumber) ||
    !hash(block.blockHash) ||
    !Number.isFinite(Date.parse(block.timestamp)) ||
    !uint(m.soldWei) ||
    BigInt(m.soldWei) > maxSold ||
    !uint(m.backingWei) ||
    BigInt(m.backingWei) > ethTarget ||
    !Array.isArray(m.candles) ||
    m.candles.length > 160 ||
    typeof m.earlier !== "boolean"
  )
    return false;
  const sold = BigInt(m.soldWei),
    backing = BigInt(m.backingWei),
    end = Date.parse(block.timestamp) / 1000;
  if (m.phase === "graduated") {
    const g = m.graduation;
    if (
      !g ||
      sold !== maxSold ||
      backing !== 0n ||
      !hash(g.poolId) ||
      !uint(g.nativeUsedWei) ||
      BigInt(g.nativeUsedWei) === 0n ||
      BigInt(g.nativeUsedWei) > ethTarget ||
      !Number.isSafeInteger(g.time) ||
      g.time <= 0 ||
      g.time > end
    )
      return false;
  } else {
    const reserve = 18n * 10n ** 26n,
      delta = reserve - sold;
    if (
      m.graduation !== null ||
      m.phase !== (sold === maxSold ? "eligible" : "curve") ||
      backing !==
        (4n * 10n ** 18n * reserve + delta - 1n) / delta - 4n * 10n ** 18n
    )
      return false;
  }
  return m.candles.every(
    (c, i) =>
      c &&
      Number.isSafeInteger(c.time) &&
      c.time > 0 &&
      c.time % interval === 0 &&
      c.time <= end &&
      (i === 0 || m.candles[i - 1].time < c.time) &&
      [c.open, c.high, c.low, c.close].every(
        (v) => Number.isFinite(v) && v > 0,
      ) &&
      c.high >= Math.max(c.open, c.close) &&
      c.low <= Math.min(c.open, c.close) &&
      Number.isSafeInteger(c.count) &&
      c.count > 0 &&
      uint(c.volumeWei) &&
      BigInt(c.volumeWei) > 0n,
  );
}
export function checkpointFresh(m: Pick<MarketSnapshot, "checkpoint">, now = Date.now()) {
  const age = now - Date.parse(m.checkpoint.timestamp);
  return age >= -15000 && age < 120000;
}

type MarketAbsence = {
  schemaVersion: 1; chainId: 4663; status: "not_found"; token: string;
  deployment: { factory: string; registry: string; blockNumber: string; blockHash: string };
  checkpoint: MarketSnapshot["checkpoint"] & { confirmations: number; finality: "l2-confirmed"; l1Finality: "unverified" };
};

// Used on both sides of the same-origin proxy; the server additionally pins the exact deployment.
export function validMarketAbsence(value: unknown, token: string, now = Date.now()): value is MarketAbsence {
  if (!value || typeof value !== "object") return false;
  const m = value as MarketAbsence, d = m.deployment, p = m.checkpoint;
  return m.status === "not_found" && m.schemaVersion === 1 && m.chainId === 4663 && m.token === token.toLowerCase()
    && typeof d?.factory === "string" && d.factory.toLowerCase() === productionTradingPins.factory.toLowerCase()
    && typeof d.registry === "string" && /^0x[0-9a-f]{40}$/i.test(d.registry)
    && typeof d.blockNumber === "string" && /^[1-9][0-9]{0,15}$/.test(d.blockNumber) && hash(d.blockHash)
    && typeof p?.blockNumber === "string" && /^[1-9][0-9]{0,15}$/.test(p.blockNumber) && BigInt(p.blockNumber) >= BigInt(d.blockNumber)
    && hash(p.blockHash) && !/^0x0+$/i.test(p.blockHash) && (p.blockNumber !== d.blockNumber || p.blockHash === d.blockHash)
    && Number.isInteger(p.confirmations) && p.confirmations >= 20 && p.confirmations <= 256
    && p.finality === "l2-confirmed" && p.l1Finality === "unverified"
    && typeof p.timestamp === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(p.timestamp)
    && checkpointFresh(m, now) && !["candles", "soldWei", "backingWei", "phase", "graduation", "events", "launches"].some(key => key in m);
}
