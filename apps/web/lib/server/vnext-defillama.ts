import { z } from "zod";

export const DEFILLAMA_SOURCE = "DEFILLAMA";
export const DEFILLAMA_CHAIN_NAME = "Robinhood Chain";
export const DEFILLAMA_CHAIN_PATH = "Robinhood%20Chain";
export const DEFILLAMA_BASE_URL = "https://api.llama.fi";

const TIMEOUT_MS = 8_000;

const DEFILLAMA_CHAIN_ID = "4663";

export type DefiLlamaStatus = "ready" | "partial" | "unavailable";
type DefiLlamaComponentStatus = Exclude<DefiLlamaStatus, "partial">;

type MarketFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

type NumericLike = number | string | null | undefined;

type FeeDataType = "dailyFees" | "dailyRevenue" | "dailyProtocolRevenue";

type DefiLlamaDependencies = {
  fetch?: MarketFetch;
  timeoutMs?: number;
};

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

export type DefiLlamaFeeComponentResult = {
  status: DefiLlamaComponentStatus;
  reason?: string;
  total24hUsd?: number;
  total7dUsd?: number;
};

export type DefiLlamaFeeOverview = {
  source: typeof DEFILLAMA_SOURCE;
  metric: "chain_fees_revenue";
  dataset: "overview-fees";
  status: "ready" | "partial";
  observedAt: string;
  chain: string;
  fees24hUsd?: number;
  fees7dUsd?: number;
  revenue24hUsd?: number;
  revenue7dUsd?: number;
  protocolRevenue24hUsd?: number;
  protocolRevenue7dUsd?: number;
  components: {
    dailyFees: DefiLlamaFeeComponentResult;
    dailyRevenue: DefiLlamaFeeComponentResult;
    dailyProtocolRevenue: DefiLlamaFeeComponentResult;
  };
};

type DefiLlamaUnavailable = {
  source: typeof DEFILLAMA_SOURCE;
  metric: string;
  dataset: string;
  status: "unavailable";
  observedAt: string;
  reason: string;
  chain?: string;
  components?: {
    dailyFees: DefiLlamaFeeComponentResult;
    dailyRevenue: DefiLlamaFeeComponentResult;
    dailyProtocolRevenue: DefiLlamaFeeComponentResult;
  };
};

export type DefiLlamaChainTvlResult = DefiLlamaChainTvl | DefiLlamaUnavailable;
export type DefiLlamaDexOverviewResult = DefiLlamaDexOverview | DefiLlamaUnavailable;
export type DefiLlamaFeeOverviewResult = DefiLlamaFeeOverview | DefiLlamaUnavailable;

type FeeComponentReadResult = {
  status: DefiLlamaComponentStatus;
  reason?: string;
  chain?: string;
  total24hUsd?: number;
  total7dUsd?: number;
};

const chainSchema = z.object({
  chain: z.string().optional(),
  name: z.string(),
  tvl: z.union([z.number(), z.string(), z.null()]),
  chainId: z.union([z.string(), z.number(), z.null()]).optional(),
  chainIdV2: z.union([z.string(), z.number(), z.null()]).optional()
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
        return Promise.reject(new Error(makeTimeoutErrorMessage()));
      }
      if (cause.message === makeTimeoutErrorMessage()) {
        return Promise.reject(cause);
      }
    }
    return Promise.reject(cause);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
    }
  }
}

async function parseJsonOrUnavailable<T>(response: Response, schema: z.ZodType<T>): Promise<T | null> {
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

  const match = parsed.find((entry) => entry.name === DEFILLAMA_CHAIN_NAME);
  if (!match) {
    return unavailable("chain_tvl", "v2-chains", "missing_chain");
  }

  const tvlUsd = normalizeNumber(match.tvl);
  if (tvlUsd === undefined) {
    return unavailable("chain_tvl", "v2-chains", "malformed_upstream");
  }

  const chainId = toStringId(match.chainId) ?? toStringId(match.chainIdV2);
  if (chainId && chainId !== DEFILLAMA_CHAIN_ID) {
    return unavailable("chain_tvl", "v2-chains", "wrong_chain_id");
  }

  return {
    source: DEFILLAMA_SOURCE,
    metric: "chain_tvl",
    dataset: "v2-chains",
    status: "ready",
    observedAt,
    chain: DEFILLAMA_CHAIN_NAME,
    chainId,
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

function hasNumericValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

async function readVNextDefiLlamaFeesByDataType(
  dataType: FeeDataType,
  dependencies: DefiLlamaDependencies
): Promise<FeeComponentReadResult> {
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
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "request_failed";
    return { status: "unavailable", reason };
  }

  if (!response.ok) {
    return { status: "unavailable", reason: `http_${response.status}` };
  }

  const parsed = await parseJsonOrUnavailable(response, feeSchema);
  if (!parsed) {
    return { status: "unavailable", reason: "malformed_upstream" };
  }

  if (parsed.chain !== DEFILLAMA_CHAIN_NAME) {
    return {
      status: "unavailable",
      reason: "wrong_chain",
      chain: parsed.chain
    };
  }

  const total24hUsd = normalizeNumber(parsed.total24h);
  const total7dUsd = normalizeNumber(parsed.total7d);

  if (!hasNumericValue(total24hUsd) && !hasNumericValue(total7dUsd)) {
    return {
      status: "unavailable",
      reason: "missing_meaningful_fee_data",
      chain: parsed.chain
    };
  }

  return {
    status: "ready",
    chain: parsed.chain,
    total24hUsd,
    total7dUsd
  };
}

function buildFeeComponentProvenance(result: FeeComponentReadResult): DefiLlamaFeeComponentResult {
  return {
    status: result.status,
    reason: result.reason,
    total24hUsd: result.total24hUsd,
    total7dUsd: result.total7dUsd
  };
}

function applyFeeValues(
  target: DefiLlamaFeeOverview,
  result: FeeComponentReadResult,
  dataType: FeeDataType
) {
  if (result.status !== "ready") {
    return;
  }

  if (dataType === "dailyFees") {
    if (hasNumericValue(result.total24hUsd)) {
      target.fees24hUsd = result.total24hUsd;
    }
    if (hasNumericValue(result.total7dUsd)) {
      target.fees7dUsd = result.total7dUsd;
    }
    return;
  }

  if (dataType === "dailyRevenue") {
    if (hasNumericValue(result.total24hUsd)) {
      target.revenue24hUsd = result.total24hUsd;
    }
    if (hasNumericValue(result.total7dUsd)) {
      target.revenue7dUsd = result.total7dUsd;
    }
    return;
  }

  if (dataType === "dailyProtocolRevenue") {
    if (hasNumericValue(result.total24hUsd)) {
      target.protocolRevenue24hUsd = result.total24hUsd;
    }
    if (hasNumericValue(result.total7dUsd)) {
      target.protocolRevenue7dUsd = result.total7dUsd;
    }
  }
}

export async function readVNextDefiLlamaFeesOverview(
  dependencies: DefiLlamaDependencies = {}
): Promise<DefiLlamaFeeOverviewResult> {
  const [fees, revenue, protocolRevenue] = await Promise.all([
    readVNextDefiLlamaFeesByDataType("dailyFees", dependencies),
    readVNextDefiLlamaFeesByDataType("dailyRevenue", dependencies),
    readVNextDefiLlamaFeesByDataType("dailyProtocolRevenue", dependencies)
  ]);

  const components = {
    dailyFees: buildFeeComponentProvenance(fees),
    dailyRevenue: buildFeeComponentProvenance(revenue),
    dailyProtocolRevenue: buildFeeComponentProvenance(protocolRevenue)
  };

  const allComponentsUnavailable =
    fees.status === "unavailable" &&
    revenue.status === "unavailable" &&
    protocolRevenue.status === "unavailable";

  const chain = fees.chain ?? revenue.chain ?? protocolRevenue.chain;
  if (!chain) {
    return unavailable("chain_fees_revenue", "overview-fees", "missing_chain");
  }

  const allWrongChain =
    fees.reason === "wrong_chain" &&
    revenue.reason === "wrong_chain" &&
    protocolRevenue.reason === "wrong_chain";

  if (allComponentsUnavailable && allWrongChain) {
    return unavailable("chain_fees_revenue", "overview-fees", "missing_chain");
  }

  if (allComponentsUnavailable) {
    return {
      source: DEFILLAMA_SOURCE,
      metric: "chain_fees_revenue",
      dataset: "overview-fees",
      status: "unavailable",
      observedAt: new Date().toISOString(),
      reason: "all_components_unavailable",
      chain: DEFILLAMA_CHAIN_NAME,
      components
    };
  }

  const readyComponentCount = [fees, revenue, protocolRevenue]
    .filter((component) => component.status === "ready").length;
  const normalized: DefiLlamaFeeOverview = {
    source: DEFILLAMA_SOURCE,
    metric: "chain_fees_revenue",
    dataset: "overview-fees",
    status: readyComponentCount === 3 ? "ready" : "partial",
    observedAt: new Date().toISOString(),
    chain,
    components
  };

  applyFeeValues(normalized, fees, "dailyFees");
  applyFeeValues(normalized, revenue, "dailyRevenue");
  applyFeeValues(normalized, protocolRevenue, "dailyProtocolRevenue");

  const hasAnyValue =
    normalized.fees24hUsd !== undefined ||
    normalized.fees7dUsd !== undefined ||
    normalized.revenue24hUsd !== undefined ||
    normalized.revenue7dUsd !== undefined ||
    normalized.protocolRevenue24hUsd !== undefined ||
    normalized.protocolRevenue7dUsd !== undefined;

  if (!hasAnyValue) {
    return unavailable("chain_fees_revenue", "overview-fees", "missing_meaningful_fee_data");
  }

  return normalized;
}
