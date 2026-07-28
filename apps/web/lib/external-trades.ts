import { getAddress, isAddress } from "viem";

export type ExternalPoolTrade = {
  id: string;
  transactionHash: `0x${string}`;
  trader: `0x${string}`;
  side: "buy" | "sell";
  tokenAmount: number;
  quoteAmount: number;
  volumeUsd: number;
  timestamp: string;
};

export type ExternalPoolTradesPayload = {
  token: `0x${string}`;
  pair: `0x${string}`;
  source: "GeckoTerminal";
  updatedAt: string;
  trades: ExternalPoolTrade[];
};

type RawTrade = {
  id?: unknown;
  attributes?: {
    tx_hash?: unknown;
    tx_from_address?: unknown;
    from_token_amount?: unknown;
    to_token_amount?: unknown;
    from_token_address?: unknown;
    to_token_address?: unknown;
    block_timestamp?: unknown;
    kind?: unknown;
    volume_in_usd?: unknown;
  };
};

function finitePositive(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function address(value: unknown) {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : null;
}

export function externalTradesRequestUrl(pair: string, token: string) {
  if (!isAddress(pair) || !isAddress(token)) throw new Error("Invalid trade tape address.");
  const url = new URL(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${getAddress(pair)}/trades`);
  url.searchParams.set("token", getAddress(token));
  url.searchParams.set("trade_volume_in_usd_greater_than", "0");
  return url.toString();
}

export function parseExternalPoolTrades(payload: unknown, token: string, limit = 20) {
  if (!isAddress(token) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Invalid trade tape request.");
  }
  const requested = getAddress(token).toLowerCase();
  const data = payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: RawTrade[] }).data
    : null;
  if (!data) throw new Error("Trade tape response was malformed.");

  const trades: ExternalPoolTrade[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    const attributes = item.attributes;
    const fromAddress = address(attributes?.from_token_address);
    const toAddress = address(attributes?.to_token_address);
    const transactionHash = typeof attributes?.tx_hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(attributes.tx_hash)
      ? attributes.tx_hash as `0x${string}`
      : null;
    const trader = address(attributes?.tx_from_address);
    const side = attributes?.kind === "buy" || attributes?.kind === "sell" ? attributes.kind : null;
    const timestamp = typeof attributes?.block_timestamp === "string" && Number.isFinite(Date.parse(attributes.block_timestamp))
      ? new Date(attributes.block_timestamp).toISOString()
      : null;
    const fromAmount = finitePositive(attributes?.from_token_amount);
    const toAmount = finitePositive(attributes?.to_token_amount);
    const volumeUsd = finitePositive(attributes?.volume_in_usd);
    const tokenIsFrom = fromAddress?.toLowerCase() === requested;
    const tokenIsTo = toAddress?.toLowerCase() === requested;
    if (
      !item.id || typeof item.id !== "string" || seen.has(item.id)
      || !transactionHash || !trader || !side || !timestamp
      || fromAmount === null || toAmount === null || volumeUsd === null
      || tokenIsFrom === tokenIsTo
    ) continue;

    seen.add(item.id);
    trades.push({
      id: item.id.slice(0, 180),
      transactionHash,
      trader,
      side,
      tokenAmount: tokenIsFrom ? fromAmount : toAmount,
      quoteAmount: tokenIsFrom ? toAmount : fromAmount,
      volumeUsd,
      timestamp
    });
  }
  return trades
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, limit);
}
