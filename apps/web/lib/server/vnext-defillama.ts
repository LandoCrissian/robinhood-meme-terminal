import { z } from "zod";

export const DEFILLAMA_SOURCE = "DEFILLAMA";
export const DEFILLAMA_CHAIN_NAME = "Robinhood Chain";
export const DEFILLAMA_CHAIN_PATH = "Robinhood%20Chain";
export const DEFILLAMA_BASE_URL = "https://api.llama.fi";
const TIMEOUT_MS = 8_000;

type MarketFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type DefiLlamaStatus = "ready" | "unavailable";

export type DefiLlamaChainTvl = {
  source: typeof DEFILLAMA_SOURCE;
  metric: "chain_tvl";
  dataset: "v2-chains";
  status: "ready";
  observedAt: string;
  chain: string;
  tvlUsd: number;
  chainId?: string;
};

export type DefiLlamaDexOverview = {
  source: typeof DEFILLAMA_SOURCE;
  metric: "chain_dex_totals";
  dataset: "overview-dexs";
  status: "ready";
  observedAt: string;
  chain: string;
  totalUsd: number;
  total24hUsd: number;
  total7dUsd: number;
  change1dPct?: number;
  change7dPct?: number;
};

export type DefiLlamaFeeOverview = {
  source: typeof DEFILLAMA_SOURCE;
  metric: "chain_fees_revenue";
  dataset: "overview-fees";
  status: "ready";
  observedAt: string;
  chain: string;
  totalFeesUsd?: number;
  totalRevenueUsd?: number;
  totalProtocolRevenueUsd?: number;
};

type DefiLlamaUnavailable = {
  source: typeof DEFILLAMA_SOURCE;
  metric: string;
  dataset: string;
  status: "unavailable";
  observedAt: string;
  reason: string;
};

export type DefiLlamaChainTvlResult = DefiLlamaChainTvl | DefiLlamaUnavailable;
export type DefiLlamaDexOverviewResult = DefiLlamaDexOverview | DefiLlamaUnavailable;
export type DefiLlamaFeeOverviewResult = DefiLlamaFeeOverview | DefiLlamaUnavailable;

const chainSchema = z.object({
  chain: z.string(),
  tvl: z.number().nonnegative(),
  chainId: z.string().optional(),
  chainIdV2: z.string().optional(),
  cmcId: z.string().optional()
}).passthrough();

const chainsSchema = z.array(chainSchema).min(1);

const dexsSchema = z.object({
  chain: z.string(),
  total24h: z.number().nonnegative(),
  total24hPrev: z.number().optional(),
  total7d: z.number().nonnegative(),
  total7dPrev: z.number().optional(),
  change_1d: z.number().optional(),
  change_7d: z.number().optional()
}).passthrough();

const feesSchema = z.object({
  chain: z.string(),
  total: z.number().optional(),
  totalRevenue: z.number().optional(),
  protocolRevenue: z.number().optional(),
  total24h: z.number().optional()
}).passthrough();

type DefiLlamaDependencies = {
  fetch?: MarketFetch;
  timeoutMs?: number;
};

function unavailable(metric: string, dataset: string, reason: string): DefiLlamaUnavailable {
  return {
    source: DEFILLAMA_SOURCE,
    metric,
    dataset,
    status: "unavailable",
    observedAt: new Date().toISOString(),
    reason
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number, fetchImpl: MarketFetch): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const timeoutError = new Error("DefiLlama request timed out.");
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(timeoutError), timeoutMs);
  });
  try {
    return await Promise.race([
      fetchImpl(url, {
        ...options,
        signal: controller.signal
      }),
      timeoutPromise
    ]);
  } catch (cause) {
    if (cause === timeoutError || (cause instanceof DOMException && cause.name === "AbortError")) {
      throw new Error("DefiLlama request timed out.");
    }
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readVNextDefiLlamaChainTvl(
  dependencies: DefiLlamaDependencies = {}
): Promise<DefiLlamaChainTvlResult> {
  const fetchImpl = dependencies.fetch ?? fetch;
  const request = `${DEFILLAMA_BASE_URL}/v2/chains`;
  let response: Response;
  try {
    response = await fetchWithTimeout(
      request,
      {
        headers: { Accept: "application/json" },
        cache: "no-store"
      },
      dependencies.timeoutMs ?? TIMEOUT_MS,
      fetchImpl
    );
  } catch (cause) {
    return unavailable("chain_tvl", "v2-chains", String(cause instanceof Error ? cause.message : "request_failed"));
  }

  if (!response.ok) {
    return unavailable("chain_tvl", "v2-chains", `http_${response.status}`);
  }

  const parsed = chainsSchema.safeParse(await response.json());
  if (!parsed.success) {
    return unavailable("chain_tvl", "v2-chains", "malformed_upstream");
  }

  const match = parsed.data.find((entry) => entry.chain === DEFILLAMA_CHAIN_NAME);
  if (!match) {
    return unavailable("chain_tvl", "v2-chains", "missing_chain");
  }

  return {
    source: DEFILLAMA_SOURCE,
    metric: "chain_tvl",
    dataset: "v2-chains",
    status: "ready",
    observedAt: new Date().toISOString(),
    chain: match.chain,
    chainId: match.chainId ?? match.chainIdV2 ?? match.cmcId,
    tvlUsd: match.tvl
  };
}

export async function readVNextDefiLlamaDexsOverview(
  dependencies: DefiLlamaDependencies = {}
): Promise<DefiLlamaDexOverviewResult> {
  const fetchImpl = dependencies.fetch ?? fetch;
  const request = `${DEFILLAMA_BASE_URL}/overview/dexs/${DEFILLAMA_CHAIN_PATH}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(
      request,
      {
        headers: { Accept: "application/json" },
        cache: "no-store"
      },
      dependencies.timeoutMs ?? TIMEOUT_MS,
      fetchImpl
    );
  } catch (cause) {
    return unavailable("chain_dex_totals", "overview-dexs", String(cause instanceof Error ? cause.message : "request_failed"));
  }

  if (!response.ok) {
    return unavailable("chain_dex_totals", "overview-dexs", `http_${response.status}`);
  }

  const parsed = dexsSchema.safeParse(await response.json());
  if (!parsed.success) {
    return unavailable("chain_dex_totals", "overview-dexs", "malformed_upstream");
  }
  const total24h = numberOrUndefined(parsed.data.total24h);
  if (total24h === undefined) {
    return unavailable("chain_dex_totals", "overview-dexs", "missing_total_24h");
  }

  return {
    source: DEFILLAMA_SOURCE,
    metric: "chain_dex_totals",
    dataset: "overview-dexs",
    status: "ready",
    observedAt: new Date().toISOString(),
    chain: parsed.data.chain,
    totalUsd: total24h,
    total24hUsd: total24h,
    total7dUsd: parsed.data.total7d,
    change1dPct: numberOrUndefined(parsed.data.change_1d),
    change7dPct: numberOrUndefined(parsed.data.change_7d)
  };
};

export async function readVNextDefiLlamaFeesOverview(
  dependencies: DefiLlamaDependencies = {}
): Promise<DefiLlamaFeeOverviewResult> {
  const fetchImpl = dependencies.fetch ?? fetch;
  const request = `${DEFILLAMA_BASE_URL}/overview/fees/${DEFILLAMA_CHAIN_PATH}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(
      request,
      {
        headers: { Accept: "application/json" },
        cache: "no-store"
      },
      dependencies.timeoutMs ?? TIMEOUT_MS,
      fetchImpl
    );
  } catch (cause) {
    return unavailable("chain_fees_revenue", "overview-fees", String(cause instanceof Error ? cause.message : "request_failed"));
  }

  if (!response.ok) {
    return unavailable("chain_fees_revenue", "overview-fees", `http_${response.status}`);
  }

  const parsed = feesSchema.safeParse(await response.json());
  if (!parsed.success) {
    return unavailable("chain_fees_revenue", "overview-fees", "malformed_upstream");
  }

  return {
    source: DEFILLAMA_SOURCE,
    metric: "chain_fees_revenue",
    dataset: "overview-fees",
    status: "ready",
    observedAt: new Date().toISOString(),
    chain: parsed.data.chain,
    totalFeesUsd: numberOrUndefined(parsed.data.total),
    totalRevenueUsd: numberOrUndefined(parsed.data.totalRevenue),
    totalProtocolRevenueUsd: numberOrUndefined(parsed.data.protocolRevenue)
  };
}
