import type { UniversalMarketResolution, UniversalMarketPool } from "../external-market";
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
  resolution?: UniversalMarketResolution;
};

export type VNextUniversalMarketSearchResult = {
  query: string;
  queryKind: "token-or-pool-address" | "v4-pool-id" | "text";
  status:
    | "found"
    | "not_found"
    | "not_listed"
    | "not_admitted"
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
  const token0 = canonicalAddress(candidate.token0);
  const token1 = address(candidate.token1);
  const transactionHash = bytes32(candidate.transactionHash);
  const blockHash = bytes32(candidate.blockHash);
  const blockNumber = typeof candidate.blockNumber === "string" && INTEGER_PATTERN.test(candidate.blockNumber) && candidate.blockNumber.length <= 78
    ? candidate.blockNumber
    : null;
  if (!sourceId || !protocol || !version || !token0 || !token1 || token0 === token1 || !transactionHash || !blockHash || blockNumber === null) return null;
  if (
    token0 === ZERO_ADDRESS &&
    !(sourceId === "uniswap-v4" && protocol === "uniswap" && version === 4)
  ) return null;

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

export function parseExactLiveResolution(value: unknown, identity: { address: string; name: string; symbol: string; decimals: number }): UniversalMarketResolution | null {
  const r = record(value), token = record(r?.token);
  if (!r || !token || r.chainId !== 4663 || r.requestedKind !== "token" || address(r.requestedAddress) !== identity.address
    || r.status !== "pool-found" || r.provenance !== "robinhood-chain-contract-reads" || r.marketData !== "identity-only"
    || address(token.address) !== identity.address || token.name !== identity.name || token.symbol !== identity.symbol || token.decimals !== identity.decimals
    || typeof token.totalSupply !== "string" || !INTEGER_PATTERN.test(token.totalSupply) || token.totalSupply.length > 78 || BigInt(token.totalSupply) <= 0n
    || typeof r.resolvedAt !== "string" || !Number.isFinite(Date.parse(r.resolvedAt))
    || !Array.isArray(r.pools) || !r.pools.length || r.pools.length > 8) return null;
  const pools: UniversalMarketPool[] = [];
  for (const candidate of r.pools) {
    const p = record(candidate), poolAddress = address(p?.poolAddress), token0 = address(p?.token0), token1 = address(p?.token1), quoteToken = address(p?.quoteToken);
    if (!p || !poolAddress || !token0 || !token1 || token0 === token1 || !quoteToken || ![token0, token1].includes(identity.address)
      || ![token0, token1].includes(quoteToken) || quoteToken === identity.address || p.canonical !== true
      || !["uniswap-v2", "uniswap-v3", "sushi-v2", "sushi-v3"].includes(String(p.venue))
      || (p.protocolVersion !== 2 && p.protocolVersion !== 3) || !String(p.venue).endsWith(`v${p.protocolVersion}`)
      || (p.protocolVersion === 2 ? p.fee !== null : !Number.isSafeInteger(p.fee) || Number(p.fee) < 1 || Number(p.fee) > 1_000_000)
      || (p.execution !== "route-check-required" && p.execution !== "view-only")) return null;
    pools.push({ venue: p.venue as UniversalMarketPool["venue"], protocolVersion: p.protocolVersion, poolAddress, token0, token1, quoteToken,
      fee: p.fee as number | null, canonical: true, execution: p.execution });
  }
  if (r.execution !== "route-check-required" && r.execution !== "view-only") return null;
  return { chainId: 4663, requestedAddress: identity.address, requestedKind: "token", status: "pool-found",
    token: { ...identity, totalSupply: token.totalSupply }, pools, marketData: "identity-only", execution: r.execution,
    provenance: "robinhood-chain-contract-reads", resolvedAt: r.resolvedAt };
}

export function parseVNextUniversalMarketSearchResult(value: unknown): VNextUniversalMarketSearchResult | null {
  const candidate = record(value);
  if (!candidate || typeof candidate.query !== "string" || candidate.query.length > 160) return null;
  if (candidate.queryKind !== "token-or-pool-address" && candidate.queryKind !== "v4-pool-id" && candidate.queryKind !== "text") return null;
  if (candidate.status !== "found" && candidate.status !== "not_found" && candidate.status !== "not_listed" && candidate.status !== "not_admitted" && candidate.status !== "invalid_query" && candidate.status !== "inventory_unavailable" && candidate.status !== "candidate_discovery_unavailable") return null;
  if (!Array.isArray(candidate.results) || candidate.results.length > 12) return null;
  const results = candidate.results.flatMap((value): VNextUniversalMarketSearchResultItem[] => {
    const item = record(value);
    const tokenAddress = address(item?.address);
    const matchedBy = item?.matchedBy;
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    const symbol = typeof item?.symbol === "string" ? item.symbol.trim() : "";
    const allowedMatches: VNextUniversalMarketSearchMatchedBy[] = ["token", "pool", "pool-id", "symbol", "name", "normalized-symbol", "normalized-name", "plural-alias"];
    if (!item || !tokenAddress || !name || name.length > 80 || !symbol || symbol.length > 20 || /[\u0000-\u001f\u007f]/.test(name) || /[\u0000-\u001f\u007f]/.test(symbol) || !Number.isSafeInteger(item.decimals) || Number(item.decimals) < 0 || Number(item.decimals) > 36 || typeof matchedBy !== "string" || !allowedMatches.includes(matchedBy as VNextUniversalMarketSearchMatchedBy) || !Array.isArray(item.markets) || item.markets.length > 500 || ((matchedBy === "pool" || matchedBy === "pool-id") && item.markets.length === 0)) return [];
    const markets = item.markets.map(parseVNextUniversalMarketSearchPool);
    if (markets.some((market) => market === null)) return [];
    const resolution = item.resolution === undefined ? undefined : parseExactLiveResolution(item.resolution, { address: tokenAddress, name, symbol, decimals: Number(item.decimals) });
    if (resolution === null) return [];
    return [{
      address: tokenAddress,
      name,
      symbol,
      decimals: Number(item.decimals),
      matchedBy: matchedBy as VNextUniversalMarketSearchMatchedBy,
      markets: markets as VNextUniversalMarketSearchPool[],
      ...(resolution ? { resolution } : {})
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
