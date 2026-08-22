import { getAddress, type Address } from "viem";
import {
  readVNextCanonicalMarketInventory,
  type VNextCanonicalMarketInventoryPool,
  type VNextCanonicalMarketInventoryQuery,
  type VNextCanonicalMarketInventoryResult
} from "./vnext-market-indexer";
import { readRobinhoodTokenIdentity } from "./universal-market-resolver";
import {
  ROBINHOOD_USDG_ADDRESS,
  ROBINHOOD_WETH_ADDRESS
} from "../vnext/robinhood-assets";
import type {
  VNextUniversalMarketSearchMatchedBy,
  VNextUniversalMarketSearchPool,
  VNextUniversalMarketSearchResult,
  VNextUniversalMarketSearchResultItem
} from "../vnext/universal-market-search-contract";

export type {
  VNextUniversalMarketSearchMatchedBy,
  VNextUniversalMarketSearchPool,
  VNextUniversalMarketSearchResult,
  VNextUniversalMarketSearchResultItem
} from "../vnext/universal-market-search-contract";

const DEX_SCREENER_SEARCH_URL = "https://api.dexscreener.com/latest/dex/search";
const ROBINHOOD_CHAIN_SLUG = "robinhood";
const DEFAULT_SEARCH_TIMEOUT_MS = 5_000;
const MINIMUM_SEARCH_TIMEOUT_MS = 250;
const MAXIMUM_SEARCH_TIMEOUT_MS = 10_000;
const MAXIMUM_SEARCH_QUERY_LENGTH = 160;
const MAXIMUM_PROVIDER_RESPONSE_BYTES = 1_000_000;
const MAXIMUM_PROVIDER_PAIRS = 30;
const MAXIMUM_CANDIDATE_TOKENS = 12;
const MAXIMUM_RESULTS = 12;
const INVENTORY_LIMIT = 100;

const ADDRESS_INPUT_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_INPUT_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const HEX_PREFIX_PATTERN = /^0x/i;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

type TokenIdentity = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
};

type InventoryReader = (
  query: VNextCanonicalMarketInventoryQuery
) => Promise<VNextCanonicalMarketInventoryResult>;

type IdentityReader = (address: Address) => Promise<TokenIdentity | null>;

type SearchFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export type VNextUniversalMarketSearchDependencies = {
  readInventory?: InventoryReader;
  readIdentity?: IdentityReader;
  fetch?: SearchFetch;
  timeoutMs?: number;
};

type CandidatePair = {
  chainId?: unknown;
  baseToken?: { address?: unknown };
  quoteToken?: { address?: unknown };
};

type CandidateDiscoveryResult =
  | { status: "ready"; addresses: string[] }
  | { status: "unavailable" };

type Match = {
  matchedBy: Extract<
    VNextUniversalMarketSearchMatchedBy,
    "symbol" | "name" | "normalized-symbol" | "normalized-name" | "plural-alias"
  >;
  priority: number;
};

class CandidateDiscoveryTimeoutError extends Error {}

function emptyResult(
  query: string,
  queryKind: VNextUniversalMarketSearchResult["queryKind"],
  status: Exclude<VNextUniversalMarketSearchResult["status"], "found">
): VNextUniversalMarketSearchResult {
  return { query, queryKind, status, results: [] };
}

function normalizeAddress(value: string) {
  if (!ADDRESS_INPUT_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === ZERO_ADDRESS ? null : normalized;
}

function normalizePoolId(value: string) {
  if (!BYTES32_INPUT_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === ZERO_BYTES32 ? null : normalized;
}

function normalizeSearchText(value: string) {
  const trimmed = value.trim();
  const withoutLeadingDollar = trimmed.startsWith("$")
    ? trimmed.slice(1)
    : trimmed;
  return withoutLeadingDollar.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeSeparators(value: string) {
  return normalizeSearchText(value).replace(/[\s_-]+/g, "");
}

function singularize(value: string) {
  return value.length > 1 && value.endsWith("s") ? value.slice(0, -1) : value;
}

function matchIdentity(query: string, identity: TokenIdentity): Match | null {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedSymbol = normalizeSearchText(identity.symbol);
  const normalizedName = normalizeSearchText(identity.name);
  if (normalizedQuery === normalizedSymbol) {
    return { matchedBy: "symbol", priority: 0 };
  }
  if (normalizedQuery === normalizedName) {
    return { matchedBy: "name", priority: 1 };
  }

  const compactQuery = normalizeSeparators(query);
  const compactSymbol = normalizeSeparators(identity.symbol);
  const compactName = normalizeSeparators(identity.name);
  if (compactQuery === compactSymbol) {
    return { matchedBy: "normalized-symbol", priority: 2 };
  }
  if (compactQuery === compactName) {
    return { matchedBy: "normalized-name", priority: 3 };
  }
  if (
    compactQuery !== "" &&
    (singularize(compactQuery) === singularize(compactSymbol) ||
      singularize(compactQuery) === singularize(compactName))
  ) {
    return { matchedBy: "plural-alias", priority: 4 };
  }
  return null;
}

function inventoryUnavailable(result: VNextCanonicalMarketInventoryResult) {
  return result.status !== "verified_shadow";
}

function marketIdentity(pool: VNextCanonicalMarketInventoryPool) {
  return `${pool.sourceId}:${pool.poolKey}`;
}

function mergeMarkets(
  current: VNextCanonicalMarketInventoryPool[],
  additional: VNextCanonicalMarketInventoryPool[]
) {
  return [
    ...new Map(
      [...current, ...additional].map((market) => [marketIdentity(market), market])
    ).values()
  ].sort((left, right) => marketIdentity(left).localeCompare(marketIdentity(right)));
}

function settlementPriority(address: string) {
  const normalized = address.toLowerCase();
  return normalized === ROBINHOOD_WETH_ADDRESS.toLowerCase() ||
    normalized === ROBINHOOD_USDG_ADDRESS.toLowerCase()
    ? 1
    : 0;
}

function publicMarket(pool: VNextCanonicalMarketInventoryPool): VNextUniversalMarketSearchPool {
  return {
    sourceId: pool.sourceId,
    protocol: pool.protocol,
    version: pool.version,
    poolKey: pool.poolKey,
    poolAddress: pool.poolAddress,
    token0: pool.token0,
    token1: pool.token1,
    stable: pool.stable,
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
    hooks: pool.hooks,
    transactionHash: pool.transactionHash,
    blockNumber: pool.blockNumber,
    blockHash: pool.blockHash,
    stateStatus: pool.stateStatus,
    liveFee: pool.liveFee,
    feeDenominator: pool.feeDenominator,
    gaugeAddress: pool.gaugeAddress,
    gaugeAlive: pool.gaugeAlive,
    gaugeWeight: pool.gaugeWeight,
    gaugeClaimable: pool.gaugeClaimable,
    feesAddress: pool.feesAddress,
    bribeAddress: pool.bribeAddress,
    stateObservedBlock: pool.stateObservedBlock,
    stateObservedBlockHash: pool.stateObservedBlockHash
  };
}

function normalizeVerifiedIdentity(identity: TokenIdentity, expectedAddress: string) {
  const address = normalizeAddress(identity.address);
  const name = typeof identity.name === "string" ? identity.name.trim() : "";
  const symbol = typeof identity.symbol === "string" ? identity.symbol.trim() : "";
  if (
    address !== expectedAddress ||
    name.length < 1 ||
    name.length > 80 ||
    symbol.length < 1 ||
    symbol.length > 20 ||
    /[\u0000-\u001f\u007f]/.test(name) ||
    /[\u0000-\u001f\u007f]/.test(symbol) ||
    !Number.isSafeInteger(identity.decimals) ||
    identity.decimals < 0 ||
    identity.decimals > 36
  ) {
    return null;
  }
  return { address, name, symbol, decimals: identity.decimals };
}

async function verifiedIdentityResult(
  address: string,
  markets: VNextUniversalMarketSearchPool[],
  matchedBy: VNextUniversalMarketSearchMatchedBy,
  readIdentity: IdentityReader
): Promise<VNextUniversalMarketSearchResultItem | null> {
  const rawIdentity = await readIdentity(getAddress(address));
  if (!rawIdentity) return null;
  const identity = normalizeVerifiedIdentity(rawIdentity, address.toLowerCase());
  if (!identity) return null;
  return {
    address: identity.address,
    name: identity.name,
    symbol: identity.symbol,
    decimals: identity.decimals,
    matchedBy,
    markets
  };
}

async function exactAddressSearch(
  query: string,
  address: string,
  dependencies: Required<Pick<VNextUniversalMarketSearchDependencies, "readInventory" | "readIdentity">>
): Promise<VNextUniversalMarketSearchResult> {
  const [tokenInventory, poolInventory] = await Promise.all([
    dependencies.readInventory({ token: address, limit: INVENTORY_LIMIT }),
    dependencies.readInventory({ poolKey: address, limit: INVENTORY_LIMIT })
  ]);
  if (inventoryUnavailable(tokenInventory) || inventoryUnavailable(poolInventory)) {
    return emptyResult(query, "token-or-pool-address", "inventory_unavailable");
  }

  const candidates = new Map<
    string,
    { markets: VNextCanonicalMarketInventoryPool[]; matchedBy: "token" | "pool" }
  >();
  if (tokenInventory.pools.length > 0) {
    candidates.set(address, { markets: tokenInventory.pools, matchedBy: "token" });
  }
  for (const market of poolInventory.pools) {
    for (const tokenAddress of [market.token0, market.token1]) {
      const current = candidates.get(tokenAddress);
      candidates.set(tokenAddress, {
        markets: mergeMarkets(current?.markets ?? [], [market]),
        matchedBy: current?.matchedBy ?? "pool"
      });
    }
  }

  const results = (
    await Promise.all(
      [...candidates.entries()].map(([candidate, evidence]) =>
        verifiedIdentityResult(
          candidate,
          evidence.markets.map(publicMarket),
          evidence.matchedBy,
          dependencies.readIdentity
        )
      )
    )
  )
    .filter((result): result is VNextUniversalMarketSearchResultItem => result !== null)
    .sort(
      (left, right) =>
        settlementPriority(left.address) - settlementPriority(right.address) ||
        left.address.localeCompare(right.address)
    );
  return {
    query,
    queryKind: "token-or-pool-address",
    status: results.length > 0 ? "found" : "not_found",
    results
  };
}

async function exactPoolIdSearch(
  query: string,
  poolId: string,
  dependencies: Required<Pick<VNextUniversalMarketSearchDependencies, "readInventory" | "readIdentity">>
): Promise<VNextUniversalMarketSearchResult> {
  const inventory = await dependencies.readInventory({
    poolKey: poolId,
    limit: INVENTORY_LIMIT
  });
  if (inventoryUnavailable(inventory)) {
    return emptyResult(query, "v4-pool-id", "inventory_unavailable");
  }
  const candidates = new Map<string, VNextCanonicalMarketInventoryPool[]>();
  for (const market of inventory.pools) {
    for (const address of [market.token0, market.token1]) {
      candidates.set(address, mergeMarkets(candidates.get(address) ?? [], [market]));
    }
  }
  const results = (
    await Promise.all(
      [...candidates.entries()].map(([address, markets]) =>
        verifiedIdentityResult(
          address,
          markets.map(publicMarket),
          "pool-id",
          dependencies.readIdentity
        )
      )
    )
  )
    .filter((result): result is VNextUniversalMarketSearchResultItem => result !== null)
    .sort(
      (left, right) =>
        settlementPriority(left.address) - settlementPriority(right.address) ||
        left.address.localeCompare(right.address)
    );
  return {
    query,
    queryKind: "v4-pool-id",
    status: results.length > 0 ? "found" : "not_found",
    results
  };
}

async function fetchWithTimeout(
  url: URL,
  timeoutMs: number,
  fetchImplementation: SearchFetch
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new CandidateDiscoveryTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetchImplementation(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal
      }),
      timeoutPromise
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function discoverCandidates(
  query: string,
  fetchImplementation: SearchFetch,
  timeoutMs: number
): Promise<CandidateDiscoveryResult> {
  const requestUrl = new URL(DEX_SCREENER_SEARCH_URL);
  requestUrl.search = new URLSearchParams({ q: query }).toString();

  let response: Response;
  try {
    response = await fetchWithTimeout(requestUrl, timeoutMs, fetchImplementation);
  } catch {
    return { status: "unavailable" };
  }
  if (!response.ok) return { status: "unavailable" };
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAXIMUM_PROVIDER_RESPONSE_BYTES
  ) {
    return { status: "unavailable" };
  }

  let body: unknown;
  try {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAXIMUM_PROVIDER_RESPONSE_BYTES) {
      return { status: "unavailable" };
    }
    body = JSON.parse(text);
  } catch {
    return { status: "unavailable" };
  }
  if (
    typeof body !== "object" ||
    body === null ||
    !("pairs" in body) ||
    !Array.isArray((body as { pairs: unknown }).pairs)
  ) {
    return { status: "unavailable" };
  }

  const addresses = new Set<string>();
  const pairs = (body as { pairs: unknown[] }).pairs.slice(0, MAXIMUM_PROVIDER_PAIRS);
  for (const rawPair of pairs) {
    if (typeof rawPair !== "object" || rawPair === null) continue;
    const pair = rawPair as CandidatePair;
    if (pair.chainId !== ROBINHOOD_CHAIN_SLUG) continue;
    for (const rawAddress of [pair.baseToken?.address, pair.quoteToken?.address]) {
      if (typeof rawAddress !== "string") continue;
      const address = normalizeAddress(rawAddress);
      if (!address) continue;
      addresses.add(address);
      if (addresses.size === MAXIMUM_CANDIDATE_TOKENS) break;
    }
    if (addresses.size === MAXIMUM_CANDIDATE_TOKENS) break;
  }
  return { status: "ready", addresses: [...addresses] };
}

async function textSearch(
  query: string,
  dependencies: Required<VNextUniversalMarketSearchDependencies>
): Promise<VNextUniversalMarketSearchResult> {
  const discovery = await discoverCandidates(
    query,
    dependencies.fetch,
    dependencies.timeoutMs
  );
  if (discovery.status === "unavailable") {
    return emptyResult(query, "text", "candidate_discovery_unavailable");
  }

  const inventories = await Promise.all(
    discovery.addresses.map(async (address) => ({
      address,
      inventory: await dependencies.readInventory({
        token: address,
        limit: INVENTORY_LIMIT
      })
    }))
  );
  if (inventories.some(({ inventory }) => inventoryUnavailable(inventory))) {
    return emptyResult(query, "text", "inventory_unavailable");
  }

  const candidates = await Promise.all(
    inventories.map(async ({ address, inventory }) => {
      if (inventory.status !== "verified_shadow" || inventory.pools.length === 0) {
        return null;
      }
      const rawIdentity = await dependencies.readIdentity(getAddress(address));
      if (!rawIdentity) return null;
      const identity = normalizeVerifiedIdentity(rawIdentity, address);
      if (!identity) return null;
      const match = matchIdentity(query, identity);
      if (!match) return null;
      return {
        priority: match.priority,
        result: {
          address,
          name: identity.name,
          symbol: identity.symbol,
          decimals: identity.decimals,
          matchedBy: match.matchedBy,
          markets: inventory.pools.map(publicMarket)
        } satisfies VNextUniversalMarketSearchResultItem
      };
    })
  );
  const results = candidates
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        left.result.address.localeCompare(right.result.address)
    )
    .slice(0, MAXIMUM_RESULTS)
    .map(({ result }) => result);
  return {
    query,
    queryKind: "text",
    status: results.length > 0 ? "found" : "not_found",
    results
  };
}

export async function searchVNextUniversalMarkets(
  requestedQuery: string,
  dependencies: VNextUniversalMarketSearchDependencies = {}
): Promise<VNextUniversalMarketSearchResult> {
  const query = requestedQuery.trim();
  const exactAddress = normalizeAddress(query);
  const exactPoolId = normalizePoolId(query);
  const queryKind = exactPoolId
    ? "v4-pool-id"
    : exactAddress
      ? "token-or-pool-address"
      : "text";
  if (
    query.length === 0 ||
    query.length > MAXIMUM_SEARCH_QUERY_LENGTH ||
    (HEX_PREFIX_PATTERN.test(query) && !exactAddress && !exactPoolId)
  ) {
    return emptyResult(query, queryKind, "invalid_query");
  }

  const readDependencies = {
    readInventory:
      dependencies.readInventory ??
      ((inventoryQuery: VNextCanonicalMarketInventoryQuery) =>
        readVNextCanonicalMarketInventory(inventoryQuery)),
    readIdentity: dependencies.readIdentity ?? readRobinhoodTokenIdentity
  };
  if (exactAddress) {
    return exactAddressSearch(query, exactAddress, readDependencies);
  }
  if (exactPoolId) {
    return exactPoolIdSearch(query, exactPoolId, readDependencies);
  }

  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MINIMUM_SEARCH_TIMEOUT_MS ||
    timeoutMs > MAXIMUM_SEARCH_TIMEOUT_MS
  ) {
    return emptyResult(query, queryKind, "candidate_discovery_unavailable");
  }
  const resolvedDependencies = {
    ...readDependencies,
    fetch: dependencies.fetch ?? fetch,
    timeoutMs
  };
  return textSearch(query, resolvedDependencies);
}

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff"
};

export async function respondWithVNextUniversalMarketSearch(
  request: Request,
  search: typeof searchVNextUniversalMarkets = searchVNextUniversalMarkets
) {
  const query = new URL(request.url).searchParams.get("q");
  if (query === null) {
    return Response.json(
      { error: "A market search query is required." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
  try {
    const result = await search(query);
    const status = result.status === "invalid_query"
      ? 400
      : result.status === "inventory_unavailable" ||
          result.status === "candidate_discovery_unavailable"
        ? 503
        : 200;
    return Response.json(result, { status, headers: NO_STORE_HEADERS });
  } catch {
    return Response.json(
      {
        query: query.trim().slice(0, MAXIMUM_SEARCH_QUERY_LENGTH),
        queryKind: "text",
        status: "inventory_unavailable",
        results: []
      } satisfies VNextUniversalMarketSearchResult,
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }
}
