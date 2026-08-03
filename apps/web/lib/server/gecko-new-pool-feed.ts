import { isAddress } from "viem";
import { z } from "zod";

const GECKO_NEW_POOLS_API =
  "https://api.geckoterminal.com/api/v2/networks/robinhood/new_pools?include=base_token,quote_token,dex&page=1";
const DEXSCREENER_PAGE = "https://dexscreener.com/robinhood/";
const TIMEOUT_MS = 7_000;
const MAX_POOLS = 20;

const relationshipSchema = z.object({
  data: z.object({ id: z.string().max(160), type: z.string().max(40) })
});
const poolSchema = z.object({
  id: z.string().max(180),
  type: z.literal("pool"),
  attributes: z.object({
    address: z.string().max(80),
    base_token_price_usd: z.string().nullable().optional(),
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
  data: z.array(poolSchema).max(MAX_POOLS),
  included: z.array(includedSchema).max(80).optional()
});

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type GeckoNewPoolPair = {
  chainId: "robinhood";
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd: number;
  txns: Record<string, { buys: number; sells: number }>;
  volume: Record<string, number>;
  priceChange: Record<string, number>;
  liquidity: { usd: number };
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
  info?: { imageUrl?: string };
};

export type GeckoNewPoolSnapshot = {
  pairs: GeckoNewPoolPair[];
  delayed: boolean;
};

function finite(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : 0;
}

function resourceAddress(id: string) {
  const separator = id.indexOf("_");
  const address = separator >= 0 ? id.slice(separator + 1) : "";
  return isAddress(address) ? address : null;
}

function numberRecord(value: Record<string, string | null> | undefined) {
  return Object.fromEntries(Object.entries(value ?? {}).map(([key, entry]) => [key, finite(entry)]));
}

export function parseGeckoNewPoolPairs(payload: unknown): GeckoNewPoolPair[] {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return [];
  const included = new Map(parsed.data.included?.map((item) => [item.id, item]) ?? []);
  const pairs: GeckoNewPoolPair[] = [];

  for (const pool of parsed.data.data) {
    const pairAddress = pool.attributes.address;
    const baseId = pool.relationships.base_token.data.id;
    const quoteId = pool.relationships.quote_token.data.id;
    const baseAddress = resourceAddress(baseId);
    const quoteAddress = resourceAddress(quoteId);
    const base = included.get(baseId);
    const quote = included.get(quoteId);
    const dexId = pool.relationships.dex.data.id.trim().toLowerCase();
    const createdAt = Date.parse(pool.attributes.pool_created_at ?? "");
    if (
      !isAddress(pairAddress)
      || !baseAddress
      || !quoteAddress
      || !base
      || !quote
      || !base.attributes.name?.trim()
      || !base.attributes.symbol?.trim()
      || !quote.attributes.name?.trim()
      || !quote.attributes.symbol?.trim()
      || !dexId
      || !Number.isFinite(createdAt)
    ) continue;

    const transactions = Object.fromEntries(Object.entries(pool.attributes.transactions ?? {}).map(
      ([key, value]) => [key, {
        buys: Math.max(0, Math.trunc(finite(value.buys))),
        sells: Math.max(0, Math.trunc(finite(value.sells)))
      }]
    ));
    const imageUrl = base.attributes.image_url?.trim();
    pairs.push({
      chainId: "robinhood",
      dexId: dexId.slice(0, 30),
      url: DEXSCREENER_PAGE + pairAddress.toLowerCase(),
      pairAddress,
      baseToken: {
        address: baseAddress,
        name: base.attributes.name.trim().slice(0, 80),
        symbol: base.attributes.symbol.trim().slice(0, 20)
      },
      quoteToken: {
        address: quoteAddress,
        name: quote.attributes.name.trim().slice(0, 80),
        symbol: quote.attributes.symbol.trim().slice(0, 20)
      },
      priceUsd: finite(pool.attributes.base_token_price_usd),
      txns: transactions,
      volume: numberRecord(pool.attributes.volume_usd),
      priceChange: numberRecord(pool.attributes.price_change_percentage),
      liquidity: { usd: Math.max(0, finite(pool.attributes.reserve_in_usd)) },
      fdv: Math.max(0, finite(pool.attributes.fdv_usd)),
      marketCap: Math.max(0, finite(pool.attributes.market_cap_usd)),
      pairCreatedAt: createdAt,
      ...(imageUrl ? { info: { imageUrl } } : {})
    });
  }
  return pairs;
}

export async function fetchGeckoNewPoolSnapshot(
  dependencies: { fetch?: FetchLike } = {}
): Promise<GeckoNewPoolSnapshot> {
  const fetcher = dependencies.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(GECKO_NEW_POOLS_API, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 },
      signal: controller.signal
    });
    if (!response.ok) return { pairs: [], delayed: true };
    const payload: unknown = await response.json();
    const pairs = parseGeckoNewPoolPairs(payload);
    return { pairs, delayed: pairs.length === 0 };
  } catch {
    return { pairs: [], delayed: true };
  } finally {
    clearTimeout(timeout);
  }
}
