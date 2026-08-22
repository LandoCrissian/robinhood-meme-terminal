const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const SOURCE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

export type VNextUniversalMarketSearchMatchedBy =
  | "token"
  | "pool"
  | "pool-id"
  | "symbol"
  | "name"
  | "normalized-symbol"
  | "normalized-name"
  | "plural-alias";

export type VNextUniversalMarketSearchPool = {
  sourceId: string;
  protocol: "sushiswap" | "uniswap" | "up";
  version: 2 | 3 | 4;
  poolKey: string;
  poolAddress: string | null;
  token0: string;
  token1: string;
  stable: boolean | null;
  fee: number | null;
  tickSpacing: number | null;
  hooks: string | null;
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  stateStatus: "ready" | "error" | null;
  liveFee: number | null;
  feeDenominator: 10_000 | 1_000_000 | null;
  gaugeAddress: string | null;
  gaugeAlive: boolean | null;
  gaugeWeight: string | null;
  gaugeClaimable: string | null;
  feesAddress: string | null;
  bribeAddress: string | null;
  stateObservedBlock: string | null;
  stateObservedBlockHash: string | null;
};

export type VNextUniversalMarketSearchResultItem = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  matchedBy: VNextUniversalMarketSearchMatchedBy;
  markets: VNextUniversalMarketSearchPool[];
};

export type VNextUniversalMarketSearchResult = {
  query: string;
  queryKind: "token-or-pool-address" | "v4-pool-id" | "text";
  status:
    | "found"
    | "not_found"
    | "invalid_query"
    | "inventory_unavailable"
    | "candidate_discovery_unavailable";
  results: VNextUniversalMarketSearchResultItem[];
};

export type VNextUniversalMarketSearchStatus =
  | "idle"
  | "searching"
  | VNextUniversalMarketSearchResult["status"]
  | "unavailable";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function canonicalAddress(value: unknown) {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function address(value: unknown) {
  const normalized = canonicalAddress(value);
  return normalized === ZERO_ADDRESS ? null : normalized;
}

function bytes32(value: unknown, nonzero = false) {
  if (typeof value !== "string" || !BYTES32_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return nonzero && normalized === ZERO_BYTES32 ? null : normalized;
}

function nullableCanonicalAddress(value: unknown) {
  if (value === null) return null;
  return canonicalAddress(value) ?? undefined;
}

function nullableAddress(value: unknown) {
  if (value === null) return null;
  return address(value) ?? undefined;
}

function nullableInteger(value: unknown) {
  return value === null
    ? null
    : typeof value === "string" && INTEGER_PATTERN.test(value) && value.length <= 78
      ? value
      : undefined;
}

function nullableNumber(value: unknown) {
  return value === null ? null : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function parseVNextUniversalMarketSearchPool(value: unknown): VNextUniversalMarketSearchPool | null {
  const candidate = record(value);
  if (!candidate) return null;
  const sourceId = typeof candidate.sourceId === "string" && candidate.sourceId.length <= 64 && SOURCE_ID_PATTERN.test(candidate.sourceId)
    ? candidate.sourceId
    : null;
  const protocol = candidate.protocol === "sushiswap" || candidate.protocol === "uniswap" || candidate.protocol === "up"
    ? candidate.protocol
    : null;
  const version = candidate.version === 2 || candidate.version === 3 || candidate.version === 4 ? candidate.version : null;
  const token0 = address(candidate.token0);
  const token1 = address(candidate.token1);
  const transactionHash = bytes32(candidate.transactionHash);
  const blockHash = bytes32(candidate.blockHash);
  const blockNumber = typeof candidate.blockNumber === "string" && INTEGER_PATTERN.test(candidate.blockNumber) && candidate.blockNumber.length <= 78
    ? candidate.blockNumber
    : null;
  if (!sourceId || !protocol || !version || !token0 || !token1 || token0 === token1 || !transactionHash || !blockHash || blockNumber === null) return null;

  let poolKey: string;
  let poolAddress: string | null;
  if (version === 4) {
    const normalizedPoolId = bytes32(candidate.poolKey, true);
    if (!normalizedPoolId || candidate.poolAddress !== null || protocol !== "uniswap") return null;
    poolKey = normalizedPoolId;
    poolAddress = null;
  } else {
    const normalizedPoolAddress = address(candidate.poolKey);
    const responsePoolAddress = address(candidate.poolAddress);
    if (!normalizedPoolAddress || !responsePoolAddress || normalizedPoolAddress !== responsePoolAddress) return null;
    poolKey = normalizedPoolAddress;
    poolAddress = responsePoolAddress;
  }

  const hooks = nullableCanonicalAddress(candidate.hooks);
  const gaugeAddress = nullableAddress(candidate.gaugeAddress);
  const feesAddress = nullableAddress(candidate.feesAddress);
  const bribeAddress = nullableAddress(candidate.bribeAddress);
  const fee = nullableNumber(candidate.fee);
  const tickSpacing = nullableNumber(candidate.tickSpacing);
  const liveFee = nullableNumber(candidate.liveFee);
  const gaugeWeight = nullableInteger(candidate.gaugeWeight);
  const gaugeClaimable = nullableInteger(candidate.gaugeClaimable);
  const stateObservedBlock = nullableInteger(candidate.stateObservedBlock);
  const stateObservedBlockHash = candidate.stateObservedBlockHash === null ? null : bytes32(candidate.stateObservedBlockHash) ?? undefined;
  if ([hooks, gaugeAddress, feesAddress, bribeAddress, fee, tickSpacing, liveFee, gaugeWeight, gaugeClaimable, stateObservedBlock, stateObservedBlockHash].some((entry) => entry === undefined)) return null;
  if (candidate.stable !== null && typeof candidate.stable !== "boolean") return null;
  if (candidate.stateStatus !== null && candidate.stateStatus !== "ready" && candidate.stateStatus !== "error") return null;
  if (candidate.gaugeAlive !== null && typeof candidate.gaugeAlive !== "boolean") return null;
  if (candidate.feeDenominator !== null && candidate.feeDenominator !== 10_000 && candidate.feeDenominator !== 1_000_000) return null;
  if (version === 2 && (
    fee !== null
    || tickSpacing !== null
    || hooks !== null
    || (protocol === "up" ? sourceId !== "up-v2" || typeof candidate.stable !== "boolean" : candidate.stable !== null)
  )) return null;
  if (version === 3 && (
    candidate.stable !== null
    || tickSpacing === null
    || hooks !== null
    || (protocol === "up" ? sourceId !== "up-cl" || fee !== null : fee === null)
  )) return null;
  if (version === 4 && (candidate.stable !== null || fee === null || tickSpacing === null || hooks === null)) return null;

  return {
    sourceId,
    protocol,
    version,
    poolKey,
    poolAddress,
    token0,
    token1,
    stable: candidate.stable as boolean | null,
    fee: fee as number | null,
    tickSpacing: tickSpacing as number | null,
    hooks: hooks as string | null,
    transactionHash,
    blockNumber,
    blockHash,
    stateStatus: candidate.stateStatus as "ready" | "error" | null,
    liveFee: liveFee as number | null,
    feeDenominator: candidate.feeDenominator as 10_000 | 1_000_000 | null,
    gaugeAddress: gaugeAddress as string | null,
    gaugeAlive: candidate.gaugeAlive as boolean | null,
    gaugeWeight: gaugeWeight as string | null,
    gaugeClaimable: gaugeClaimable as string | null,
    feesAddress: feesAddress as string | null,
    bribeAddress: bribeAddress as string | null,
    stateObservedBlock: stateObservedBlock as string | null,
    stateObservedBlockHash: stateObservedBlockHash as string | null
  };
}

export function parseVNextUniversalMarketSearchResult(value: unknown): VNextUniversalMarketSearchResult | null {
  const candidate = record(value);
  if (!candidate || typeof candidate.query !== "string" || candidate.query.length > 160) return null;
  if (candidate.queryKind !== "token-or-pool-address" && candidate.queryKind !== "v4-pool-id" && candidate.queryKind !== "text") return null;
  if (candidate.status !== "found" && candidate.status !== "not_found" && candidate.status !== "invalid_query" && candidate.status !== "inventory_unavailable" && candidate.status !== "candidate_discovery_unavailable") return null;
  if (!Array.isArray(candidate.results) || candidate.results.length > 12) return null;
  const results = candidate.results.flatMap((value): VNextUniversalMarketSearchResultItem[] => {
    const item = record(value);
    const tokenAddress = address(item?.address);
    const matchedBy = item?.matchedBy;
    const allowedMatches: VNextUniversalMarketSearchMatchedBy[] = ["token", "pool", "pool-id", "symbol", "name", "normalized-symbol", "normalized-name", "plural-alias"];
    if (!item || !tokenAddress || typeof item.name !== "string" || item.name.length > 160 || typeof item.symbol !== "string" || item.symbol.length > 64 || !Number.isSafeInteger(item.decimals) || Number(item.decimals) < 0 || Number(item.decimals) > 255 || typeof matchedBy !== "string" || !allowedMatches.includes(matchedBy as VNextUniversalMarketSearchMatchedBy) || !Array.isArray(item.markets) || item.markets.length === 0 || item.markets.length > 500) return [];
    const markets = item.markets.map(parseVNextUniversalMarketSearchPool);
    if (markets.some((market) => market === null)) return [];
    return [{
      address: tokenAddress,
      name: item.name.trim().slice(0, 160),
      symbol: item.symbol.trim().slice(0, 64),
      decimals: Number(item.decimals),
      matchedBy: matchedBy as VNextUniversalMarketSearchMatchedBy,
      markets: markets as VNextUniversalMarketSearchPool[]
    }];
  });
  if (results.length !== candidate.results.length || (candidate.status === "found" && results.length === 0) || (candidate.status !== "found" && results.length !== 0)) return null;
  return {
    query: candidate.query,
    queryKind: candidate.queryKind,
    status: candidate.status,
    results
  };
}
