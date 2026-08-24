import { getAddress, type Address } from "viem";
import {
  publicVNextCanonicalMarketInventoryPool,
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
const BLOCKSCOUT_SEARCH_URL = "https://robinhoodchain.blockscout.com/api/v2/search";
const ROBINHOOD_CHAIN_SLUG = "robinhood";
const DEFAULT_SEARCH_TIMEOUT_MS = 5_000;
const MINIMUM_SEARCH_TIMEOUT_MS = 250;
const MAXIMUM_SEARCH_TIMEOUT_MS = 10_000;
const MAXIMUM_SEARCH_QUERY_LENGTH = 160;
const MAXIMUM_PROVIDER_RESPONSE_BYTES = 1_000_000;
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

type BlockscoutCandidate = {
  type?: unknown;
  token_type?: unknown;
  address_hash?: unknown;
  address?: unknown;
  name?: unknown;
  symbol?: unknown;
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

function isErc20IdentityCandidate(address: string) {
  return address !== ZERO_ADDRESS;
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

function inventoryIncomplete(result: VNextCanonicalMarketInventoryResult) {
  return result.status === "verified_shadow" && !result.coverage.complete;
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
  return publicVNextCanonicalMarketInventoryPool(pool);
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
  const [tokenInventoryRead, poolInventoryRead] = await Promise.allSettled([
    dependencies.readInventory({ token: address, limit: INVENTORY_LIMIT }),
    dependencies.readInventory({ poolKey: address, limit: INVENTORY_LIMIT })
  ]);
  const tokenInventory = tokenInventoryRead.status === "fulfilled"
    ? tokenInventoryRead.value
    : null;
  const poolInventory = poolInventoryRead.status === "fulfilled"
    ? poolInventoryRead.value
    : null;

  const candidates = new Map<
    string,
    { markets: VNextCanonicalMarketInventoryPool[]; matchedBy: "token" | "pool" }
  >();
  const canonicalPoolEvidence = poolInventory?.status === "verified_shadow"
    ? poolInventory.pools
    : [];
  if (canonicalPoolEvidence.length > 0) {
    for (const market of canonicalPoolEvidence) {
      for (const tokenAddress of [market.token0, market.token1]) {
        if (!isErc20IdentityCandidate(tokenAddress)) continue;
        const current = candidates.get(tokenAddress);
        candidates.set(tokenAddress, {
          markets: mergeMarkets(current?.markets ?? [], [market]),
          matchedBy: current?.matchedBy ?? "pool"
        });
      }
    }
  } else {
    const tokenMarkets = tokenInventory?.status === "verified_shadow"
      ? tokenInventory.pools
      : [];
    candidates.set(address, { markets: tokenMarkets, matchedBy: "token" });
  }

  const identityReads = await Promise.allSettled(
      [...candidates.entries()].map(([candidate, evidence]) =>
        verifiedIdentityResult(
          candidate,
          evidence.markets.map(publicMarket),
          evidence.matchedBy,
          dependencies.readIdentity
        )
      )
  );
  const results = identityReads
    .flatMap((read) => read.status === "fulfilled" ? [read.value] : [])
    .filter((result): result is VNextUniversalMarketSearchResultItem => result !== null)
    .sort(
      (left, right) =>
        settlementPriority(left.address) - settlementPriority(right.address) ||
        left.address.localeCompare(right.address)
    );
  if (
    results.length === 0 &&
    (
      tokenInventory === null ||
      poolInventory === null ||
      inventoryUnavailable(tokenInventory) ||
      inventoryUnavailable(poolInventory) ||
      inventoryIncomplete(tokenInventory) ||
      inventoryIncomplete(poolInventory)
    )
  ) {
    return emptyResult(query, "token-or-pool-address", "inventory_unavailable");
  }
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
      if (!isErc20IdentityCandidate(address)) continue;
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
  if (results.length === 0 && inventoryIncomplete(inventory)) {
    return emptyResult(query, "v4-pool-id", "inventory_unavailable");
  }
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
  const readBoundedJson = async (requestUrl: URL) => {
    let response: Response;
    try {
      response = await fetchWithTimeout(requestUrl, timeoutMs, fetchImplementation);
    } catch {
      return null;
    }
    if (!response.ok) return null;
    const contentLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAXIMUM_PROVIDER_RESPONSE_BYTES
    ) {
      return null;
    }

    try {
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAXIMUM_PROVIDER_RESPONSE_BYTES) {
        return null;
      }
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  };

  const dexScreenerUrl = new URL(DEX_SCREENER_SEARCH_URL);
  dexScreenerUrl.search = new URLSearchParams({ q: query }).toString();
  const blockscoutUrl = new URL(BLOCKSCOUT_SEARCH_URL);
  blockscoutUrl.search = new URLSearchParams({ q: query }).toString();
  const [dexScreenerBody, blockscoutBody] = await Promise.all([
    readBoundedJson(dexScreenerUrl),
    readBoundedJson(blockscoutUrl)
  ]);

  const dexScreenerReady = typeof dexScreenerBody === "object" &&
    dexScreenerBody !== null &&
    "pairs" in dexScreenerBody &&
    Array.isArray((dexScreenerBody as { pairs: unknown }).pairs);
  const blockscoutReady = typeof blockscoutBody === "object" &&
    blockscoutBody !== null &&
    "items" in blockscoutBody &&
    Array.isArray((blockscoutBody as { items: unknown }).items);
  if (!dexScreenerReady && !blockscoutReady) return { status: "unavailable" };

  const dexScreenerAddresses = new Set<string>();
  if (dexScreenerReady) {
    for (const rawPair of (dexScreenerBody as { pairs: unknown[] }).pairs) {
      if (typeof rawPair !== "object" || rawPair === null) continue;
      const pair = rawPair as CandidatePair;
      if (pair.chainId !== ROBINHOOD_CHAIN_SLUG) continue;
      for (const rawAddress of [pair.baseToken?.address, pair.quoteToken?.address]) {
        if (typeof rawAddress !== "string") continue;
        const address = normalizeAddress(rawAddress);
        if (!address) continue;
        dexScreenerAddresses.add(address);
        if (dexScreenerAddresses.size === MAXIMUM_CANDIDATE_TOKENS) break;
      }
      if (dexScreenerAddresses.size === MAXIMUM_CANDIDATE_TOKENS) break;
    }
  }

  const blockscoutAddresses = new Set<string>();
  if (blockscoutReady) {
    const rankedItems = (blockscoutBody as { items: unknown[] }).items
      .flatMap((rawItem, index) => {
        if (typeof rawItem !== "object" || rawItem === null) return [];
        const item = rawItem as BlockscoutCandidate;
        if (item.type !== "token" || item.token_type !== "ERC-20") return [];
        const hint = matchIdentity(query, {
          address: ZERO_ADDRESS,
          name: typeof item.name === "string" ? item.name : "",
          symbol: typeof item.symbol === "string" ? item.symbol : "",
          decimals: 0
        });
        return [{ item, index, priority: hint?.priority ?? Number.MAX_SAFE_INTEGER }];
      })
      .sort((left, right) => left.priority - right.priority || left.index - right.index);
    for (const { item } of rankedItems) {
      const rawAddress = typeof item.address_hash === "string"
        ? item.address_hash
        : item.address;
      if (typeof rawAddress !== "string") continue;
      const address = normalizeAddress(rawAddress);
      if (!address) continue;
      blockscoutAddresses.add(address);
      if (blockscoutAddresses.size === MAXIMUM_CANDIDATE_TOKENS) break;
    }
  }

  const sources = [[...dexScreenerAddresses], [...blockscoutAddresses]];
  const addresses = new Set<string>();
  for (let index = 0; addresses.size < MAXIMUM_CANDIDATE_TOKENS; index += 1) {
    let advanced = false;
    for (const source of sources) {
      const address = source[index];
      if (!address) continue;
      advanced = true;
      addresses.add(address);
      if (addresses.size === MAXIMUM_CANDIDATE_TOKENS) break;
    }
    if (!advanced) break;
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

  const candidates = await Promise.all(
    discovery.addresses.map(async (address) => {
      const [identityRead, inventoryRead] = await Promise.allSettled([
        dependencies.readIdentity(getAddress(address)),
        dependencies.readInventory({ token: address, limit: INVENTORY_LIMIT })
      ]);
      if (identityRead.status !== "fulfilled" || !identityRead.value) return null;
      const rawIdentity = identityRead.value;
      const identity = normalizeVerifiedIdentity(rawIdentity, address);
      if (!identity) return null;
      const match = matchIdentity(query, identity);
      if (!match) return null;
      const inventory = inventoryRead.status === "fulfilled" &&
        inventoryRead.value.status === "verified_shadow"
        ? inventoryRead.value
        : null;
      return {
        priority: match.priority,
        result: {
          address,
          name: identity.name,
          symbol: identity.symbol,
          decimals: identity.decimals,
          matchedBy: match.matchedBy,
          markets: (inventory?.pools ?? []).map(publicMarket)
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
