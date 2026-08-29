import { z } from "zod";
import { DEFILLAMA_CHAIN_NAME, DEFILLAMA_SOURCE } from "./vnext-defillama";

const STABLECOIN_BASE = "https://stablecoins.llama.fi";
const TIMEOUT_MS = 8_000;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type VNextCapitalFlow = {
  schemaVersion: 1;
  chainId: 4663;
  chain: typeof DEFILLAMA_CHAIN_NAME;
  source: typeof DEFILLAMA_SOURCE;
  authoritative: false;
  status: "ready" | "partial" | "unavailable";
  asOf: string;
  stablecoinMarketCapUsd: number | null;
  stablecoinChange7dPct: number | null;
  usdgMarketCapUsd: number | null;
  usdgDominancePct: number | null;
};

const chainSchema = z.array(z.object({
  name: z.string(),
  totalCirculatingUSD: z.object({ peggedUSD: z.number().finite().nonnegative() }).passthrough()
}).passthrough());
const chartSchema = z.array(z.object({
  date: z.string().regex(/^\d+$/),
  totalCirculatingUSD: z.object({ peggedUSD: z.number().finite().nonnegative() }).passthrough()
}).passthrough()).min(1);
const assetsSchema = z.object({
  peggedAssets: z.array(z.object({
    symbol: z.string(),
    chainCirculating: z.record(z.string(), z.object({
      current: z.object({ peggedUSD: z.number().finite().nonnegative().optional() }).passthrough().optional()
    }).passthrough()).optional()
  }).passthrough())
}).passthrough();

async function readJson(url: string, fetchImpl: FetchLike, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) return null;
    return await response.json() as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readVNextDefiLlamaCapitalFlow(dependencies: { fetch?: FetchLike; timeoutMs?: number; now?: () => number } = {}): Promise<VNextCapitalFlow> {
  const fetchImpl = dependencies.fetch ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? TIMEOUT_MS;
  const [rawChains, rawChart, rawAssets] = await Promise.all([
    readJson(`${STABLECOIN_BASE}/stablecoinchains`, fetchImpl, timeoutMs),
    readJson(`${STABLECOIN_BASE}/stablecoincharts/Robinhood`, fetchImpl, timeoutMs),
    readJson(`${STABLECOIN_BASE}/stablecoins?includePrices=true`, fetchImpl, timeoutMs)
  ]);
  const chains = chainSchema.safeParse(rawChains);
  const exactChain = chains.success ? chains.data.find((chain) => chain.name === DEFILLAMA_CHAIN_NAME) : undefined;
  const asOf = new Date(dependencies.now?.() ?? Date.now()).toISOString();
  if (!exactChain) return {
    schemaVersion: 1, chainId: 4663, chain: DEFILLAMA_CHAIN_NAME, source: DEFILLAMA_SOURCE,
    authoritative: false, status: "unavailable", asOf,
    stablecoinMarketCapUsd: null, stablecoinChange7dPct: null, usdgMarketCapUsd: null, usdgDominancePct: null
  };

  const chart = chartSchema.safeParse(rawChart);
  const assets = assetsSchema.safeParse(rawAssets);
  const stablecoinMarketCapUsd = exactChain.totalCirculatingUSD.peggedUSD;
  let stablecoinChange7dPct: number | null = null;
  if (chart.success) {
    const ordered = [...chart.data].sort((left, right) => Number(left.date) - Number(right.date));
    const latest = ordered.at(-1)?.totalCirculatingUSD.peggedUSD;
    const previous = ordered.at(-8)?.totalCirculatingUSD.peggedUSD;
    if (latest !== undefined && previous !== undefined && previous > 0) {
      stablecoinChange7dPct = (latest - previous) / previous * 100;
    }
  }
  const usdgMarketCapUsd = assets.success
    ? assets.data.peggedAssets
        .filter((asset) => asset.symbol.toUpperCase() === "USDG")
        .reduce((total, asset) => total + (asset.chainCirculating?.[DEFILLAMA_CHAIN_NAME]?.current?.peggedUSD ?? 0), 0)
    : null;
  const normalizedUsdg = usdgMarketCapUsd !== null && usdgMarketCapUsd > 0 ? usdgMarketCapUsd : null;
  const dominance = normalizedUsdg !== null && stablecoinMarketCapUsd > 0
    ? normalizedUsdg / stablecoinMarketCapUsd * 100
    : null;
  const usdgDominancePct = dominance !== null && dominance <= 100 ? dominance : null;
  const available = [stablecoinMarketCapUsd, stablecoinChange7dPct, normalizedUsdg, usdgDominancePct].filter((value) => value !== null).length;
  return {
    schemaVersion: 1,
    chainId: 4663,
    chain: DEFILLAMA_CHAIN_NAME,
    source: DEFILLAMA_SOURCE,
    authoritative: false,
    status: available === 4 ? "ready" : available > 0 ? "partial" : "unavailable",
    asOf,
    stablecoinMarketCapUsd,
    stablecoinChange7dPct,
    usdgMarketCapUsd: normalizedUsdg,
    usdgDominancePct
  };
}
