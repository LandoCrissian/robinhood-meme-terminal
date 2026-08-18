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
  fees24hUsd?: number;
  fees7dUsd?: number;
  revenue24hUsd?: number;
  revenue7dUsd?: number;
  protocolRevenue24hUsd?: number;
  protocolRevenue7dUsd?: number;
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

type DefiLlamaDependencies = {
  fetch?: MarketFetch;
  timeoutMs?: number;
};

type NumericLike = number | string | null | undefined;

type FeeDataType = "dailyFees" | "dailyRevenue" | "dailyProtocolRevenue";

type DefiLlamaFeesRead = {
  chain?: string;
  total24hUsd?: number;
  total7dUsd?: number;
};

const chainSchema = z.object({
  chain: z.string(),
  tvl: z.union([z.number(), z.string()]),
  chainId: z.union([z.string(), z.number()]).optional(),
  chainIdV2: z.union([z.string(), z.number()]).optional(),
  cmcId: z.union([z.string(), z.number()]).optional()
}).passthrough();

const chainsSchema = z.array(chainSchema);

const dexsSchema = z.object({
  chain: z.string(),
  total24h: z.union([z.number(), z.string(), z.null(), z.undefined()]),
  total7d: z.union([z.number(), z.string(), z.null(), z.undefined()]),
  change_1d: z.union([z.number(), z.string(), z.null(), z.undefined()]),
  change_7d: z.union([z.number(), z.string(), z.null(), z.undefined()])
}).passthrough();

const feeSchema = z.object({
  chain: z.string(),
  total24h: z.union([z.number(), z.string(), z.null(), z.undefined()]),
  total7d: z.union([z.number(), z.string(), z.null(), z.undefined()])
}).passthrough();

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

function normalizeNumber(value: NumericLike): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string" && value !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function toStringId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function makeTimeoutErrorMessage(): string {
  return "DefiLlama request timed out.";
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  fetchImpl: MarketFetch
): Promise<Response> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new Error(makeTimeoutErrorMessage()));
    }, timeoutMs);
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
    if (cause instanceof Error) {
      if (cause.name === "AbortError") {
        throw new Error(makeTimeoutErrorMessage());
      }
      if (cause.message === makeTimeoutErrorMessage()) {
        throw cause;
      }
    }
    throw cause;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
    }
  }
}

async function parseJsonOrUnavailable<T>(
  response: Response,
  schema: z.ZodType<T>
): Promise<T | null> {
  try {
    const rawText = await response.text();
    const parsedJson = JSON.parse(rawText);
    const parsed = schema.safeParse(parsedJson);
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export async function readVNextDefiLlamaChainTvl(
  dependencies: DefiLlamaDependencies = {}
): Promise<DefiLlamaChainTvlResult> {
  const fetchImpl = dependencies.fetch ?? fetch;
  const request = `${DEFILLAMA_BASE_URL}/v2/chains`;
  const observedAt = new Date().toISOString();
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
    const reason = cause instanceof Error ? cause.message : "request_failed";
    return unavailable("chain_tvl", "v2-chains", reason);
  }

  if (!response.ok) {
    return {
      ...unavailable("chain_tvl", "v2-chains", `http_${response.status}`),
      observedAt
    };
  }

  const parsed = await parseJsonOrUnavailable(response, chainsSchema);
  if (!parsed || parsed.length === 0) {
    return unavailable("chain_tvl", "v2-chains", "malformed_upstream");
  }

  const match = parsed.find((entry) => entry.chain === DEFILLAMA_CHAIN_NAME);
  if (!match) {
    return unavailable("chain_tvl", "v2-chains", "missing_chain");
  }

  const tvlUsd = normalizeNumber(match.tvl);
  if (tvlUsd === undefined) {
    return unavailable("chain_tvl", "v2-chains", "malformed_upstream");
  }

  return {
    source: DEFILLAMA_SOURCE,
    metric: "chain_tvl",
    dataset: "v2-chains",
    status: "ready",
    observedAt,
    chain: match.chain,
    chainId: toStringId(match.chainId) ?? toStringId(match.chainIdV2) ?? toStringId(match.cmcId),
    tvlUsd
  };
}

export async function readVNextDefiLlamaDexsOverview(
  dependencies: DefiLlamaDependencies = {}
): Promise<DefiLlamaDexOverviewResult> {
  const fetchImpl = dependencies.fetch ?? fetch;
  const request = `${DEFILLAMA_BASE_URL}/overview/dexs/${DEFILLAMA_CHAIN_PATH}`;
  const observedAt = new Date().toISOString();
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
    const reason = cause instanceof Error ? cause.message : "request_failed";
    return unavailable("chain_dex_totals", "overview-dexs", reason);
  }

  if (!response.ok) {
    return {
      ...unavailable("chain_dex_totals", "overview-dexs", `http_${response.status}`),
      observedAt
    };
  }

  const parsed = await parseJsonOrUnavailable(response, dexsSchema);
  if (!parsed) {
    return unavailable("chain_dex_totals", "overview-dexs", "malformed_upstream");
  }

  if (parsed.chain !== DEFILLAMA_CHAIN_NAME) {
    return unavailable("chain_dex_totals", "overview-dexs", "wrong_chain");
  }

  const total24hUsd = normalizeNumber(parsed.total24h);
  const total7dUsd = normalizeNumber(parsed.total7d);
  if (total24hUsd === undefined || total7dUsd === undefined) {
    return unavailable("chain_dex_totals", "overview-dexs", "missing_total_24h_or_total_7d");
  }

  return {
    source: DEFILLAMA_SOURCE,
    metric: "chain_dex_totals",
    dataset: "overview-dexs",
    status: "ready",
    observedAt,
    chain: parsed.chain,
    total24hUsd,
    total7dUsd,
    change1dPct: normalizeNumber(parsed.change_1d),
    change7dPct: normalizeNumber(parsed.change_7d)
  };
}

function buildDefiLlamaFeesUrl(dataType: FeeDataType): string {
  const url = new URL(`${DEFILLAMA_BASE_URL}/overview/fees/${DEFILLAMA_CHAIN_PATH}`);
  url.searchParams.set("dataType", dataType);
  return url.toString();
}

async function readVNextDefiLlamaFeesByDataType(
  dataType: FeeDataType,
  dependencies: DefiLlamaDependencies
): Promise<DefiLlamaFeesRead> {
  const fetchImpl = dependencies.fetch ?? fetch;
  const request = buildDefiLlamaFeesUrl(dataType);

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
  } catch {
    return {};
  }

  if (!response.ok) {
    return {};
  }

  const parsed = await parseJsonOrUnavailable(response, feeSchema);
  if (!parsed) {
    return {};
  }

  if (parsed.chain !== DEFILLAMA_CHAIN_NAME) {
    return {};
  }

  return {
    chain: parsed.chain,
    total24hUsd: normalizeNumber(parsed.total24h),
    total7dUsd: normalizeNumber(parsed.total7d)
  };
}

export async function readVNextDefiLlamaFeesOverview(
  dependencies: DefiLlamaDependencies = {}
): Promise<DefiLlamaFeeOverviewResult> {
  const [fees, revenue, protocolRevenue] = await Promise.all([
    readVNextDefiLlamaFeesByDataType("dailyFees", dependencies),
    readVNextDefiLlamaFeesByDataType("dailyRevenue", dependencies),
    readVNextDefiLlamaFeesByDataType("dailyProtocolRevenue", dependencies)
  ]);

  const chain = fees.chain ?? revenue.chain ?? protocolRevenue.chain;
  if (!chain) {
    return unavailable("chain_fees_revenue", "overview-fees", "missing_chain");
  }

  const observedAt = new Date().toISOString();
  const normalized: DefiLlamaFeeOverview = {
    source: DEFILLAMA_SOURCE,
    metric: "chain_fees_revenue",
    dataset: "overview-fees",
    status: "ready",
    observedAt,
    chain
  };

  if (fees.total24hUsd !== undefined) {
    normalized.fees24hUsd = fees.total24hUsd;
  }
  if (fees.total7dUsd !== undefined) {
    normalized.fees7dUsd = fees.total7dUsd;
  }
  if (revenue.total24hUsd !== undefined) {
    normalized.revenue24hUsd = revenue.total24hUsd;
  }
  if (revenue.total7dUsd !== undefined) {
    normalized.revenue7dUsd = revenue.total7dUsd;
  }
  if (protocolRevenue.total24hUsd !== undefined) {
    normalized.protocolRevenue24hUsd = protocolRevenue.total24hUsd;
  }
  if (protocolRevenue.total7dUsd !== undefined) {
    normalized.protocolRevenue7dUsd = protocolRevenue.total7dUsd;
  }

  if (
    normalized.fees24hUsd === undefined
    && normalized.fees7dUsd === undefined
    && normalized.revenue24hUsd === undefined
    && normalized.revenue7dUsd === undefined
    && normalized.protocolRevenue24hUsd === undefined
    && normalized.protocolRevenue7dUsd === undefined
  ) {
    return unavailable("chain_fees_revenue", "overview-fees", "missing_meaningful_fee_data");
  }

  return normalized;
}
