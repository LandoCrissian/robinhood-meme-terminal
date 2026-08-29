import { getAddress, isAddress, zeroAddress } from "viem";
import { z } from "zod";
import { canonicalExternalPoolIdentity } from "../external-market-identity";
import {
  ROBINHOOD_USDG_ADDRESS,
  ROBINHOOD_WETH_ADDRESS
} from "../vnext/robinhood-assets";

const GECKO_POOLS_API = "https://api.geckoterminal.com/api/v2/networks/robinhood";
const DEXSCREENER_PAGE = "https://dexscreener.com/robinhood/";
const TIMEOUT_MS = 7_000;
const MAX_POOLS_PER_PAGE = 20;
const MAX_INCLUDED_PER_PAGE = 80;

export type GeckoPoolFeedId = "new" | "top" | "trending-1h";

export const GECKO_POOL_FEEDS: ReadonlyArray<{
  id: GeckoPoolFeedId;
  endpoint: "new_pools" | "pools" | "trending_pools";
  pages: readonly number[];
  duration?: "5m" | "1h" | "24h";
}> = [
  { id: "new", endpoint: "new_pools", pages: [1] },
  { id: "top", endpoint: "pools", pages: [1] },
  { id: "trending-1h", endpoint: "trending_pools", duration: "1h", pages: [1] }
];

const INFRASTRUCTURE_ASSETS = new Set([
  zeroAddress,
  ROBINHOOD_WETH_ADDRESS.toLowerCase(),
  ROBINHOOD_USDG_ADDRESS.toLowerCase()
]);

const relationshipSchema = z.object({
  data: z.object({ id: z.string().max(160), type: z.string().max(40) })
});
const poolSchema = z.object({
  id: z.string().max(180),
  type: z.literal("pool"),
  attributes: z.object({
    address: z.string().max(80),
    base_token_price_usd: z.string().nullable().optional(),
    quote_token_price_usd: z.string().nullable().optional(),
    pool_created_at: z.string().nullable().optional(),
    fdv_usd: z.string().nullable().optional(),
    market_cap_usd: z.string().nullable().optional(),
    price_change_percentage: z.record(z.string(), z.string().nullable()).optional(),
    transactions: z.record(z.string(), z.object({
      buys: z.number().nonnegative().optional(),
      sells: z.number().nonnegative().optional()
    })).optional(),
    volume_usd: z.record(z.string(), z.string().nullable()).optional(),
    reserve_in_usd: z.string().nullable().optional()
  }),
  relationships: z.object({
    base_token: relationshipSchema,
    quote_token: relationshipSchema,
    dex: relationshipSchema
  })
});
const includedSchema = z.object({
  id: z.string().max(180),
  type: z.string().max(40),
  attributes: z.object({
    address: z.string().max(80).optional(),
    name: z.string().max(160).optional(),
    symbol: z.string().max(60).optional(),
    image_url: z.string().max(500).nullable().optional()
  }).passthrough()
});
const payloadSchema = z.object({
  data: z.array(poolSchema).max(MAX_POOLS_PER_PAGE),
  included: z.array(includedSchema).max(MAX_INCLUDED_PER_PAGE).optional()
});

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type GeckoPoolPair = {
  chainId: "robinhood";
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd: number | null;
  txns: Record<string, { buys: number | null; sells: number | null }>;
  volume: Record<string, number | null>;
  priceChange: Record<string, number | null>;
  liquidity: { usd: number | null };
  fdv: number | null;
  marketCap: number | null;
  pairCreatedAt: number | null;
  info?: { imageUrl?: string };
  discoveryFeeds: GeckoPoolFeedId[];
};

export type GeckoPoolSnapshot = {
  pairs: GeckoPoolPair[];
  delayed: boolean;
  delayedFeeds: GeckoPoolFeedId[];
};

function finite(value: unknown) {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function nonNegative(value: unknown) {
  const number = finite(value);
  return number !== null && number >= 0 ? number : null;
}

function nonNegativeInteger(value: unknown) {
  const number = nonNegative(value);
  return number !== null && Number.isSafeInteger(number) ? number : null;
}

function resourceAddress(id: string) {
  const prefix = "robinhood_";
  const address = id.toLowerCase().startsWith(prefix) ? id.slice(prefix.length) : "";
  return isAddress(address, { strict: false }) ? getAddress(address) : null;
}

function numberRecord(value: Record<string, string | null> | undefined) {
  return Object.fromEntries(Object.entries(value ?? {}).map(([key, entry]) => [key, finite(entry)]));
}

function tokenLabel(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function geckoPoolFeedUrl(
  feed: (typeof GECKO_POOL_FEEDS)[number],
  page: number
) {
  const url = new URL(`${GECKO_POOLS_API}/${feed.endpoint}`);
  url.searchParams.set("include", "base_token,quote_token,dex");
  url.searchParams.set("page", String(page));
  if (feed.duration) url.searchParams.set("duration", feed.duration);
  return url;
}

export function parseGeckoPoolPairs(payload: unknown, feed: GeckoPoolFeedId): GeckoPoolPair[] {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return [];
  const included = new Map(parsed.data.included?.map((item) => [item.id, item]) ?? []);
  const pairs: GeckoPoolPair[] = [];

  for (const pool of parsed.data.data) {
    const pairAddress = pool.attributes.address.trim();
    const baseId = pool.relationships.base_token.data.id;
    const quoteId = pool.relationships.quote_token.data.id;
    const baseAddress = resourceAddress(baseId);
    const quoteAddress = resourceAddress(quoteId);
    const base = included.get(baseId);
    const quote = included.get(quoteId);
    const dexId = pool.relationships.dex.data.id.trim().toLowerCase();
    if (
      !canonicalExternalPoolIdentity(pairAddress)
      || pool.id.toLowerCase() !== `robinhood_${pairAddress.toLowerCase()}`
      || !baseAddress
      || !quoteAddress
      || (baseAddress.toLowerCase() === zeroAddress && quoteAddress.toLowerCase() === zeroAddress)
      || !dexId
    ) continue;

    const baseIsInfrastructure = INFRASTRUCTURE_ASSETS.has(baseAddress.toLowerCase());
    const quoteIsInfrastructure = INFRASTRUCTURE_ASSETS.has(quoteAddress.toLowerCase());
    if (baseIsInfrastructure && quoteIsInfrastructure) continue;
    const displayQuoteSide = baseIsInfrastructure && !quoteIsInfrastructure;
    const directoryBaseAddress = displayQuoteSide ? quoteAddress : baseAddress;
    const directoryQuoteAddress = displayQuoteSide ? baseAddress : quoteAddress;
    const directoryBase = displayQuoteSide ? quote : base;
    const directoryQuote = displayQuoteSide ? base : quote;
    const baseLabel = tokenLabel(directoryBaseAddress);
    const quoteLabel = tokenLabel(directoryQuoteAddress);
    const transactions = Object.fromEntries(Object.entries(pool.attributes.transactions ?? {}).map(
      ([key, value]) => [key, {
        buys: nonNegativeInteger(value.buys),
        sells: nonNegativeInteger(value.sells)
      }]
    ));
    const imageUrl = directoryBase?.attributes.image_url?.trim();
    const createdAt = Date.parse(pool.attributes.pool_created_at ?? "");
    pairs.push({
      chainId: "robinhood",
      dexId: dexId.slice(0, 30),
      url: DEXSCREENER_PAGE + pairAddress.toLowerCase(),
      pairAddress,
      baseToken: {
        address: directoryBaseAddress,
        name: directoryBase?.attributes.name?.trim().slice(0, 80) || baseLabel,
        symbol: directoryBase?.attributes.symbol?.trim().slice(0, 20) || baseLabel
      },
      quoteToken: {
        address: directoryQuoteAddress,
        name: directoryQuote?.attributes.name?.trim().slice(0, 80) || quoteLabel,
        symbol: directoryQuote?.attributes.symbol?.trim().slice(0, 20) || quoteLabel
      },
      priceUsd: finite(displayQuoteSide
        ? pool.attributes.quote_token_price_usd
        : pool.attributes.base_token_price_usd),
      txns: transactions,
      volume: numberRecord(pool.attributes.volume_usd),
      priceChange: numberRecord(pool.attributes.price_change_percentage),
      liquidity: { usd: nonNegative(pool.attributes.reserve_in_usd) },
      // Gecko's pool-level valuation fields describe its original base token.
      // When RMT flips an infrastructure base to display the quote token, those
      // values are not evidence for the displayed asset.
      fdv: displayQuoteSide ? null : nonNegative(pool.attributes.fdv_usd),
      marketCap: displayQuoteSide ? null : nonNegative(pool.attributes.market_cap_usd),
      pairCreatedAt: Number.isFinite(createdAt) ? createdAt : null,
      ...(imageUrl ? { info: { imageUrl } } : {}),
      discoveryFeeds: [feed]
    });
  }
  return pairs;
}

async function fetchGeckoPoolPage(
  feed: (typeof GECKO_POOL_FEEDS)[number],
  page: number,
  fetcher: FetchLike
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(geckoPoolFeedUrl(feed, page), {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return payloadSchema.safeParse(payload).success
      ? parseGeckoPoolPairs(payload, feed.id)
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchGeckoPoolSnapshot(
  dependencies: { fetch?: FetchLike } = {}
): Promise<GeckoPoolSnapshot> {
  const fetcher = dependencies.fetch ?? fetch;
  const requests = GECKO_POOL_FEEDS.flatMap((feed) => feed.pages.map((page) => ({ feed, page })));
  const responses = await Promise.all(requests.map(async ({ feed, page }) => ({
    feed,
    pairs: await fetchGeckoPoolPage(feed, page, fetcher)
  })));
  const delayedFeeds = [...new Set(responses.flatMap(({ feed, pairs }) => pairs === null ? [feed.id] : []))];
  const byPool = new Map<string, GeckoPoolPair>();
  for (const { pairs } of responses) {
    for (const pair of pairs ?? []) {
      const key = `${pair.chainId}:${pair.pairAddress.toLowerCase()}`;
      const existing = byPool.get(key);
      byPool.set(key, existing
        ? { ...existing, discoveryFeeds: [...new Set([...existing.discoveryFeeds, ...pair.discoveryFeeds])] }
        : pair);
    }
  }
  return {
    pairs: [...byPool.values()],
    delayed: delayedFeeds.length > 0,
    delayedFeeds
  };
}
