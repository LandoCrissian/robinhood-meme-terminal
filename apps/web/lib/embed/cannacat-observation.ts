/** Passive pool observation only. This module cannot quote, authorize or send a trade. */
export type CannaCatSpot = { chainId: 4663; sqrtPriceX96: bigint; blockNumber: bigint; blockHash: string; observedAtMs: number };
export type CannaCatObservation = { side: "buy" | "sell"; inputAmountAtomic: string; expectedOutputAtomic: string;
  feeEstimateAtomic: string; observedAtMs: number; expiresAtMs: number; source: "Verified CannaCat pool spot" | "Requested 0x price" };
const Q192 = 2n ** 192n;
const MAX = 2n ** 256n - 1n;
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;

/** One in-flight read and a bounded freshness window per browser, without wallet data. */
export function createCannaCatSpotReader(read: () => Promise<CannaCatSpot>, now = Date.now) {
  let cached: CannaCatSpot | null = null;
  let pending: Promise<CannaCatSpot> | null = null;
  return async () => {
    if (cached && now() >= cached.observedAtMs && now() - cached.observedAtMs < 15_000) return cached;
    if (pending) return pending;
    pending = read().then(value => {
      if (value.chainId !== 4663 || value.sqrtPriceX96 <= 0n || value.sqrtPriceX96 >= 2n ** 160n
        || value.blockNumber <= 0n || !/^0x[0-9a-f]{64}$/i.test(value.blockHash)
        || value.observedAtMs > now() + 5000 || now() - value.observedAtMs > 60_000) {
        throw new Error("Fresh CannaCat pool price is unavailable. Your amount is retained.");
      }
      cached = value; return value;
    }).catch(() => {
      // RPC libraries include URLs, calldata and long diagnostic tokens. They
      // are not user-facing pricing messages and must not distort mobile layout.
      throw new Error("Live CannaCat pricing is temporarily unavailable. Your amount and last estimate are retained; retrying automatically.");
    }).finally(() => { pending = null; });
    return pending;
  };
}

/** Both assets have 18 decimals. Spot ignores liquidity impact and hook/LP costs;
 * it is never a minimum received, an executable route, or a spending authorization. */
export function observeCannaCatAmount(spot: CannaCatSpot, input: {
  side: "buy" | "sell"; tokenAmountAtomic: string; ethInputAtomic: string | null;
}, now = Date.now()): CannaCatObservation {
  if (spot.chainId !== 4663 || spot.sqrtPriceX96 <= 0n || spot.sqrtPriceX96 >= 2n ** 160n
    || now < spot.observedAtMs || now - spot.observedAtMs > 60_000) throw new Error("CannaCat pool price is stale. Your amount is retained.");
  const ratio = spot.sqrtPriceX96 ** 2n;
  const amount = BigInt(input.ethInputAtomic ?? input.tokenAmountAtomic);
  if (amount <= 0n || amount > MAX) throw new Error("Enter a positive amount.");
  let paid: bigint; let received: bigint; let fee: bigint;
  if (input.side === "sell") {
    paid = amount; const gross = amount * Q192 / ratio; fee = gross * 25n / 10_000n; received = gross - fee;
  } else if (input.ethInputAtomic !== null) {
    paid = amount; fee = paid * 25n / 10_000n; received = (paid - fee) * ratio / Q192;
  } else {
    received = amount; paid = ceil(ceil(amount * Q192, ratio) * 10_000n, 9975n); fee = paid * 25n / 10_000n;
  }
  if (paid <= 0n || received <= 0n || paid > MAX || received > MAX) throw new Error("This amount is outside the indicative price range.");
  return { side: input.side, inputAmountAtomic: paid.toString(), expectedOutputAtomic: received.toString(), feeEstimateAtomic: fee.toString(),
    observedAtMs: spot.observedAtMs, expiresAtMs: spot.observedAtMs + 60_000, source: "Verified CannaCat pool spot" };
}
