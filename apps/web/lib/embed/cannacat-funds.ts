import { parseUnits } from "viem";

export type BuyInputMode = "token" | "eth" | "usd";
export const ETH_USD_URL = "https://api.exchange.coinbase.com/products/ETH-USD/ticker";
export const BALANCE_MAX_AGE_MS = 20_000;
export const PRICE_MAX_AGE_MS = 120_000;
export type EthUsdPrice = { usdE8: bigint; source: "Coinbase Exchange ETH-USD"; priceAtMs: number; checkedAtMs: number };
export type CannaCatFunds = { key: string; wallet: string; chainId: 4663; checkedAtMs: number; block: bigint;
  blockHash: `0x${string}`; eth: bigint; token: bigint; gasPrice: bigint };

export function freshEthUsd(price: EthUsdPrice | null, now = Date.now()): price is EthUsdPrice {
  return Boolean(price && price.usdE8 > 0n && now >= price.checkedAtMs && now - price.checkedAtMs <= PRICE_MAX_AGE_MS
    && price.priceAtMs <= now + 5_000 && now - price.priceAtMs <= PRICE_MAX_AGE_MS);
}
export function parseEthUsd(value: unknown, now = Date.now()): EthUsdPrice {
  if (!value || typeof value !== "object" || !("price" in value) || !("time" in value)
    || typeof value.price !== "string" || !/^[1-9][0-9]{0,7}(?:\.[0-9]{1,8})?$/.test(value.price)
    || typeof value.time !== "string") throw new Error("The ETH/USD source returned invalid price evidence.");
  const price: EthUsdPrice = { usdE8: parseUnits(value.price, 8), source: "Coinbase Exchange ETH-USD", priceAtMs: Date.parse(value.time), checkedAtMs: now };
  if (!Number.isFinite(price.priceAtMs) || !freshEthUsd(price, now)) throw new Error("The ETH/USD source is stale. ETH and token inputs remain available.");
  return price;
}
export async function readEthUsd(signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const response = await fetcher(ETH_USD_URL, { credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]) });
  if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 16_384) throw new Error("ETH/USD estimate is temporarily unavailable.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("ETH/USD source returned no data.");
  let size = 0; let text = ""; const decoder = new TextDecoder();
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > 16_384) throw new Error("ETH/USD response exceeded its safety limit."); text += decoder.decode(part.value, { stream: true }); }
    text += decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
  return parseEthUsd(JSON.parse(text));
}
export function usdTargetToWei(value: string, price: EthUsdPrice | null, now = Date.now()) {
  if (!freshEthUsd(price, now)) throw new Error("A fresh ETH/USD estimate is required for USD targets. Use ETH or CannaCat instead.");
  if (!/^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,2})?$/.test(value)) throw new Error("Enter a positive USD target with at most two decimal places.");
  const wei = parseUnits(value, 2) * 10n ** 24n / price.usdE8;
  if (wei <= 0n) throw new Error("Enter a positive USD target.");
  return wei;
}
export function approximateUsd(wei: bigint | string, price: EthUsdPrice | null, now = Date.now()) {
  if (!freshEthUsd(price, now)) return null;
  // Floating point is display only. All intent conversion and spend limits use integers.
  const product = BigInt(wei) * price.usdE8;
  if (product > 0n && product < 10n ** 24n) return "<$0.01";
  const dollars = Number(product / 10n ** 18n) / 1e8;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(dollars);
}
export function freshCannaCatFunds(funds: CannaCatFunds | null, key: string, wallet: string, now = Date.now()): funds is CannaCatFunds {
  return Boolean(funds && funds.chainId === 4663 && funds.key === key && funds.wallet.toLowerCase() === wallet.toLowerCase()
    && now >= funds.checkedAtMs && now - funds.checkedAtMs <= BALANCE_MAX_AGE_MS && funds.gasPrice > 0n && funds.eth >= 0n && funds.token >= 0n);
}
// Conservative prequote budget only. The canonical verifier checks the actual
// transaction gas limit/fee ceiling again before enabling wallet confirmation.
export function cannaCatQuoteBudget(funds: CannaCatFunds) {
  const reserve = funds.gasPrice * 3n * 1_000_000n;
  return { reserve, spendable: funds.eth > reserve ? funds.eth - reserve : 0n };
}
