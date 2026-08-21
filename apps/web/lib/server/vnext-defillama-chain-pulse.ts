import {
  DEFILLAMA_CHAIN_NAME,
  DEFILLAMA_SOURCE,
  readVNextDefiLlamaChainTvl,
  readVNextDefiLlamaDexsOverview,
  readVNextDefiLlamaFeesOverview
} from "./vnext-defillama";

type ComponentStatus = "ready" | "unavailable";
type SourceStatus = ComponentStatus | "partial";
type PulseStatus = "ready" | "partial" | "unavailable";

export type DefiLlamaChainPulseDependencies = {
  fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
};

type DefiLlamaFeeComponentState = {
  status: ComponentStatus;
  reason?: string;
};

type DefiLlamaFeeSource = {
  status: SourceStatus;
  observedAt: string;
  reason?: string;
  components: {
    dailyFees: DefiLlamaFeeComponentState;
    dailyRevenue: DefiLlamaFeeComponentState;
    dailyProtocolRevenue: DefiLlamaFeeComponentState;
  };
};

type DefiLlamaSourceState = {
  status: SourceStatus;
  observedAt: string;
  reason?: string;
};

export type DefiLlamaChainPulse = {
  chainId: number;
  chain: string;
  source: typeof DEFILLAMA_SOURCE;
  authoritative: false;
  status: PulseStatus;
  observedAt: string;
  tvlUsd: number | null;
  dexVolume24hUsd: number | null;
  dexVolume7dUsd: number | null;
  dexChange1dPct: number | null;
  dexChange7dPct: number | null;
  fees24hUsd: number | null;
  fees7dUsd: number | null;
  revenue24hUsd: number | null;
  revenue7dUsd: number | null;
  protocolRevenue24hUsd: number | null;
  protocolRevenue7dUsd: number | null;
  sources: {
    tvl: DefiLlamaSourceState;
    dex: DefiLlamaSourceState;
    fees: DefiLlamaFeeSource;
  };
};

const DEFILLAMA_PULSE_CHAIN_ID = 4663;

function toPulseStatus(statuses: ComponentStatus[]): PulseStatus {
  const readyCount = statuses.filter((status) => status === "ready").length;
  if (readyCount === statuses.length) {
    return "ready";
  }
  if (readyCount > 0) {
    return "partial";
  }
  return "unavailable";
}

function toNullableNumber(value: number | undefined): number | null {
  return value ?? null;
}

function normalizeFeesComponents(result: {
  components?: {
    dailyFees: { status: ComponentStatus; reason?: string; total24hUsd?: number; total7dUsd?: number };
    dailyRevenue: { status: ComponentStatus; reason?: string; total24hUsd?: number; total7dUsd?: number };
    dailyProtocolRevenue: {
      status: ComponentStatus;
      reason?: string;
      total24hUsd?: number;
      total7dUsd?: number;
    };
  };
}) {
  const components = result.components;
  return {
    dailyFees: {
      status: components?.dailyFees.status ?? "unavailable",
      reason: components?.dailyFees.reason
    },
    dailyRevenue: {
      status: components?.dailyRevenue.status ?? "unavailable",
      reason: components?.dailyRevenue.reason
    },
    dailyProtocolRevenue: {
      status: components?.dailyProtocolRevenue.status ?? "unavailable",
      reason: components?.dailyProtocolRevenue.reason
    }
  };
}
export async function readVNextDefiLlamaChainPulse(
  dependencies: DefiLlamaChainPulseDependencies = {}
): Promise<DefiLlamaChainPulse> {
  const observedAt = new Date().toISOString();

  const [tvl, dex, fees] = await Promise.all([
    readVNextDefiLlamaChainTvl(dependencies),
    readVNextDefiLlamaDexsOverview(dependencies),
    readVNextDefiLlamaFeesOverview(dependencies)
  ]);

  const tvlStatus = tvl.status;
  const dexStatus = dex.status;
  const feesStatus = fees.status;

  const feeComponents = normalizeFeesComponents(fees);
  const status = toPulseStatus([
    tvlStatus,
    dexStatus,
    feeComponents.dailyFees.status,
    feeComponents.dailyRevenue.status,
    feeComponents.dailyProtocolRevenue.status
  ]);
  const tvlReason = tvl.status === "unavailable" ? tvl.reason : undefined;
  const dexReason = dex.status === "unavailable" ? dex.reason : undefined;
  const feesReason = fees.status === "unavailable" ? fees.reason : undefined;

  return {
    chainId: DEFILLAMA_PULSE_CHAIN_ID,
    chain: DEFILLAMA_CHAIN_NAME,
    source: DEFILLAMA_SOURCE,
    authoritative: false,
    status,
    observedAt,
    tvlUsd: tvlStatus === "ready" ? toNullableNumber(tvl.tvlUsd) : null,
    dexVolume24hUsd: dexStatus === "ready" ? toNullableNumber(dex.total24hUsd) : null,
    dexVolume7dUsd: dexStatus === "ready" ? toNullableNumber(dex.total7dUsd) : null,
    dexChange1dPct: dexStatus === "ready" ? toNullableNumber(dex.change1dPct) : null,
    dexChange7dPct: dexStatus === "ready" ? toNullableNumber(dex.change7dPct) : null,
    fees24hUsd:
      feesStatus !== "unavailable"
        ? toNullableNumber((fees as { fees24hUsd?: number }).fees24hUsd)
        : null,
    fees7dUsd: feesStatus !== "unavailable" ? toNullableNumber((fees as { fees7dUsd?: number }).fees7dUsd) : null,
    revenue24hUsd:
      feesStatus !== "unavailable"
        ? toNullableNumber((fees as { revenue24hUsd?: number }).revenue24hUsd)
        : null,
    revenue7dUsd: feesStatus !== "unavailable" ? toNullableNumber((fees as { revenue7dUsd?: number }).revenue7dUsd) : null,
    protocolRevenue24hUsd:
      feesStatus !== "unavailable"
        ? toNullableNumber((fees as { protocolRevenue24hUsd?: number }).protocolRevenue24hUsd)
        : null,
    protocolRevenue7dUsd:
      feesStatus !== "unavailable"
        ? toNullableNumber((fees as { protocolRevenue7dUsd?: number }).protocolRevenue7dUsd)
        : null,
    sources: {
      tvl: {
        status: tvlStatus,
        observedAt: tvl.observedAt,
        reason: tvlReason
      },
      dex: {
        status: dexStatus,
        observedAt: dex.observedAt,
        reason: dexReason
      },
      fees: {
        status: feesStatus,
        observedAt: fees.observedAt,
        reason: feesReason,
        components: feeComponents
      }
    }
  };
}
