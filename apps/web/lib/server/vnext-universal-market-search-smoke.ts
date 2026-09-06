import assert from "node:assert/strict";
import { getAddress, type Address } from "viem";
import {
  searchVNextUniversalMarkets,
  type VNextUniversalMarketSearchDependencies
} from "./vnext-universal-market-search";
import type {
  VNextCanonicalMarketInventoryPool,
  VNextCanonicalMarketInventoryQuery,
  VNextCanonicalMarketInventoryResult
} from "./vnext-market-indexer";
import {
  ROBINHOOD_USDG_ADDRESS,
  ROBINHOOD_WETH_ADDRESS
} from "../vnext/robinhood-assets";
import type { VNextCanonicalSearchCatalog } from "./vnext-canonical-search-catalog";

const stonkBrokerAddress = "0xe934e36a439c94017b64a3fece66af12099abf50";
const sameSymbolAddressA = "0x1111111111111111111111111111111111111111";
const sameSymbolAddressB = "0x2222222222222222222222222222222222222222";
const unrelatedAddress = "0x3333333333333333333333333333333333333333";
const tokenOnlyAddress = "0x6666666666666666666666666666666666666666";
const v2PoolAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const v3PoolAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const v4PoolId = `0x${"c".repeat(64)}`;
const nativeV4PoolId = `0x${"d".repeat(64)}`;
const nativeV4TokenAddress = "0x7777777777777777777777777777777777777777";
const peepAddress = "0xf0821f2bf570ca4e7499a9ed9db7c788fed9946f";
const peepPairAddress = "0xe70dd15481ba143f145fbe23e8916236d554d3c7";
const cannaCatAddress = "0x1139d423c1706bdead91f03507f521635591ed92";
const cannaCatPoolId = "0x5f5ec0e1016bae2f04c122bbcd2c141a4177cc681d7c2e4463a1d172ed8430b3";
const hopiumAddress = "0xb6ce51925c2e397ebf1a443b343d19267b3d4225";
const hopiumPoolId = "0xc1dbd75280b6d117b4ac1e27fcd00c6dccb1a2b2fbfa9923a2c492711299d337";
const supplementalPeepAddress = "0x0dadc46063c8a4ece0a2c1d7c65f4363053c66b2";
const zeroAddress = `0x${"0".repeat(40)}`;
const manifestHash = `0x${"1".repeat(64)}`;
const blockHash = `0x${"2".repeat(64)}`;
const transactionHash = `0x${"3".repeat(64)}`;
const canonicalSourceIds = [
  "sushiswap-v2",
  "sushiswap-v3",
  "uniswap-v2",
  "uniswap-v3",
  "uniswap-v4",
  "up-v2",
  "up-cl"
] as const;

function pool(
  input: Partial<VNextCanonicalMarketInventoryPool> &
    Pick<
      VNextCanonicalMarketInventoryPool,
      "sourceId" | "protocol" | "version" | "poolKey" | "poolAddress" | "token0" | "token1"
    >
): VNextCanonicalMarketInventoryPool {
  return {
    stable: null,
    fee: null,
    tickSpacing: null,
    hooks: null,
    transactionHash,
    blockNumber: "12345",
    blockHash,
    stateStatus: null,
    liveFee: null,
    feeDenominator: null,
    gaugeAddress: null,
    gaugeAlive: null,
    gaugeWeight: null,
    gaugeClaimable: null,
    feesAddress: null,
    bribeAddress: null,
    stateError: null,
    stateObservedBlock: null,
    stateObservedBlockHash: null,
    ...input
  };
}

const v2Market = pool({
  sourceId: "uniswap-v2",
  protocol: "uniswap",
  version: 2,
  poolKey: v2PoolAddress,
  poolAddress: v2PoolAddress,
  token0: stonkBrokerAddress,
  token1: ROBINHOOD_WETH_ADDRESS.toLowerCase(),
  stateError: "internal diagnostic must not cross public search boundary"
});
const v3Market = pool({
  sourceId: "sushiswap-v3",
  protocol: "sushiswap",
  version: 3,
  poolKey: v3PoolAddress,
  poolAddress: v3PoolAddress,
  token0: stonkBrokerAddress,
  token1: ROBINHOOD_USDG_ADDRESS.toLowerCase(),
  fee: 3_000,
  tickSpacing: 60
});
const v4Market = pool({
  sourceId: "uniswap-v4",
  protocol: "uniswap",
  version: 4,
  poolKey: v4PoolId,
  poolAddress: null,
  token0: stonkBrokerAddress,
  token1: ROBINHOOD_WETH_ADDRESS.toLowerCase(),
  fee: 3_000,
  tickSpacing: 60,
  hooks: "0x0000000000000000000000000000000000000000"
});
const nativeV4Market = pool({
  sourceId: "uniswap-v4",
  protocol: "uniswap",
  version: 4,
  poolKey: nativeV4PoolId,
  poolAddress: null,
  token0: zeroAddress,
  token1: nativeV4TokenAddress,
  fee: 3_000,
  tickSpacing: 60,
  hooks: zeroAddress
});
const sameSymbolMarketA = pool({
  sourceId: "uniswap-v2",
  protocol: "uniswap",
  version: 2,
  poolKey: "0x4444444444444444444444444444444444444444",
  poolAddress: "0x4444444444444444444444444444444444444444",
  token0: sameSymbolAddressA,
  token1: ROBINHOOD_WETH_ADDRESS.toLowerCase()
});
const sameSymbolMarketB = pool({
  sourceId: "sushiswap-v2",
  protocol: "sushiswap",
  version: 2,
  poolKey: "0x5555555555555555555555555555555555555555",
  poolAddress: "0x5555555555555555555555555555555555555555",
  token0: sameSymbolAddressB,
  token1: ROBINHOOD_WETH_ADDRESS.toLowerCase()
});

const identities = new Map<string, { address: string; name: string; symbol: string; decimals: number }>([
  [stonkBrokerAddress, { address: stonkBrokerAddress, name: "StonkBroker", symbol: "STONKBROKER", decimals: 18 }],
  [sameSymbolAddressA, { address: sameSymbolAddressA, name: "Same Asset", symbol: "SAME", decimals: 18 }],
  [sameSymbolAddressB, { address: sameSymbolAddressB, name: "Same Asset", symbol: "SAME", decimals: 6 }],
  [unrelatedAddress, { address: unrelatedAddress, name: "Unrelated", symbol: "OTHER", decimals: 18 }],
  [tokenOnlyAddress, { address: tokenOnlyAddress, name: "Identity Only", symbol: "IDENTITY", decimals: 18 }],
  [v2PoolAddress, { address: v2PoolAddress, name: "Uniswap V2 LP", symbol: "UNI-V2", decimals: 18 }],
  [nativeV4TokenAddress, {
    address: nativeV4TokenAddress,
    name: "Native Pair Token",
    symbol: "NATIVEPAIR",
    decimals: 18
  }],
  [ROBINHOOD_WETH_ADDRESS.toLowerCase(), {
    address: ROBINHOOD_WETH_ADDRESS,
    name: "Wrapped Ether",
    symbol: "WETH",
    decimals: 18
  }],
  [ROBINHOOD_USDG_ADDRESS.toLowerCase(), {
    address: ROBINHOOD_USDG_ADDRESS,
    name: "Global Dollar",
    symbol: "USDG",
    decimals: 6
  }]
]);

const markets = [
  v2Market,
  v3Market,
  v4Market,
  nativeV4Market,
  sameSymbolMarketA,
  sameSymbolMarketB
];

function verifiedInventory(
  pools: VNextCanonicalMarketInventoryPool[],
  complete = true
): VNextCanonicalMarketInventoryResult {
  return {
    status: "verified_shadow",
    chainId: 4_663,
    mode: "shadow",
    authoritative: false,
    sourceManifestHash: manifestHash,
    coverage: {
      complete,
      finalizedHead: "12345",
      sources: canonicalSourceIds.map((sourceId, index) => ({
        sourceId,
        status: complete || index > 0 ? "shadow-ready" : "backfilling",
        indexedThrough: complete || index > 0 ? "12345" : "12000"
      }))
    },
    nextCursor: null,
    pools
  };
}

async function inventoryReader(
  query: VNextCanonicalMarketInventoryQuery
): Promise<VNextCanonicalMarketInventoryResult> {
  const matching = markets.filter((market) =>
    (query.token === undefined || market.token0 === query.token || market.token1 === query.token) &&
    (query.poolKey === undefined || market.poolKey === query.poolKey) &&
    (query.source === undefined || market.sourceId === query.source)
  );
  return verifiedInventory(matching.slice(0, query.limit ?? matching.length));
}

async function identityReader(address: Address) {
  return identities.get(address.toLowerCase()) ?? null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function providerPair(
  baseAddress: unknown,
  quoteAddress: unknown = ROBINHOOD_WETH_ADDRESS,
  chainId: unknown = "robinhood",
  additions: Record<string, unknown> = {}
) {
  return {
    chainId,
    baseToken: { address: baseAddress, name: "PROVIDER MUST NOT WIN", symbol: "FAKE" },
    quoteToken: { address: quoteAddress, name: "FAKE QUOTE", symbol: "FAKE" },
    dexId: "fake-provider-venue",
    priceUsd: "999999999",
    liquidity: { usd: 999999999 },
    ...additions
  };
}

function providerFetch(pairs: unknown[]) {
  return async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    assert.ok(url.searchParams.has("q"));
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("Accept"), "application/json");
    assert.equal(init?.cache, "no-store");
    if (url.origin + url.pathname === "https://api.dexscreener.com/latest/dex/search") {
      return jsonResponse({ pairs });
    }
    assert.equal(url.origin + url.pathname, "https://robinhoodchain.blockscout.com/api/v2/search");
    return jsonResponse({ items: [] });
  };
}

function blockscoutCandidate(
  address: unknown,
  additions: Record<string, unknown> = {}
) {
  return {
    type: "token",
    token_type: "ERC-20",
    address_hash: address,
    name: "PROVIDER MUST NOT WIN",
    symbol: "FAKE",
    ...additions
  };
}

function candidateFetch(input: {
  pairs?: unknown[];
  items?: unknown[];
  dexStatus?: number;
  blockscoutStatus?: number;
  dexDelayMs?: number;
  blockscoutDelayMs?: number;
}) {
  return async (requested: string | URL, init?: RequestInit) => {
    const url = new URL(requested.toString());
    assert.ok(url.searchParams.has("q"));
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("Accept"), "application/json");
    assert.equal(init?.cache, "no-store");
    const delay = (milliseconds: number) => new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, milliseconds);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(new Error("provider aborted"));
      }, { once: true });
    });
    if (url.origin + url.pathname === "https://api.dexscreener.com/latest/dex/search") {
      if (input.dexDelayMs) await delay(input.dexDelayMs);
      return jsonResponse({ pairs: input.pairs ?? [] }, input.dexStatus ?? 200);
    }
    assert.equal(url.origin + url.pathname, "https://robinhoodchain.blockscout.com/api/v2/search");
    if (input.blockscoutDelayMs) await delay(input.blockscoutDelayMs);
    return jsonResponse({ items: input.items ?? [] }, input.blockscoutStatus ?? 200);
  };
}

function dependencies(
  pairs: unknown[] = [providerPair(stonkBrokerAddress)]
): VNextUniversalMarketSearchDependencies {
  return {
    readInventory: inventoryReader,
    readIdentity: identityReader,
    fetch: providerFetch(pairs),
    timeoutMs: 500
  };
}

async function assertStonkBrokerTextSearches() {
  const cases = [
    ["STONKBROKER", "symbol"],
    ["StonkBroker", "symbol"],
    ["StonkBrokers", "plural-alias"],
    ["$STONKBROKER", "symbol"],
    ["Stonk Broker", "normalized-symbol"],
    ["Stonk-Broker", "normalized-symbol"],
    ["Stonk_Broker", "normalized-symbol"]
  ] as const;
  for (const [query, matchedBy] of cases) {
    const result = await searchVNextUniversalMarkets(query, dependencies());
    assert.equal(result.status, "found");
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.address, stonkBrokerAddress);
    assert.equal(result.results[0]?.name, "StonkBroker");
    assert.equal(result.results[0]?.symbol, "STONKBROKER");
    assert.equal(result.results[0]?.matchedBy, matchedBy);
    assert.equal(result.results[0]?.markets.some((market) => market.poolKey === v4PoolId), true);
  }
}

async function assertExactSearchesNeverUseProvider() {
  let providerCalls = 0;
  const exactDependencies = {
    readInventory: inventoryReader,
    readIdentity: identityReader,
    fetch: async () => {
      providerCalls += 1;
      return jsonResponse({ pairs: [] });
    }
  };

  for (const address of [stonkBrokerAddress, getAddress(stonkBrokerAddress)]) {
    const result = await searchVNextUniversalMarkets(address, exactDependencies);
    assert.equal(result.status, "found");
    assert.equal(result.results.some((item) => item.address === stonkBrokerAddress), true);
    assert.equal(result.results.find((item) => item.address === stonkBrokerAddress)?.matchedBy, "token");
  }

  for (const [poolKey, expectedVersion] of [[v2PoolAddress, 2], [v3PoolAddress, 3]] as const) {
    const result = await searchVNextUniversalMarkets(poolKey, exactDependencies);
    assert.equal(result.status, "found");
    assert.equal(result.results[0]?.address, stonkBrokerAddress);
    assert.equal(result.results[0]?.matchedBy, "pool");
    assert.equal(result.results[0]?.markets[0]?.version, expectedVersion);
    assert.equal("stateError" in result.results[0]!.markets[0]!, false);
    assert.equal(result.results.at(-1)?.address.toLowerCase(), expectedVersion === 2
      ? ROBINHOOD_WETH_ADDRESS.toLowerCase()
      : ROBINHOOD_USDG_ADDRESS.toLowerCase());
    assert.equal(
      result.results.some((item) => item.address === poolKey),
      false,
      "A canonical pool address must not be misclassified as its ERC-20-compatible LP token"
    );
  }

  const v4 = await searchVNextUniversalMarkets(v4PoolId, exactDependencies);
  assert.equal(v4.status, "found");
  assert.equal(v4.results[0]?.address, stonkBrokerAddress);
  assert.equal(v4.results[0]?.matchedBy, "pool-id");
  assert.equal(v4.results[0]?.markets[0]?.poolAddress, null);
  assert.equal(v4.results[0]?.markets[0]?.poolKey, v4PoolId);
  assert.equal(providerCalls, 0);
}

async function assertTokenOnlyExactIdentityIsFound() {
  const result = await searchVNextUniversalMarkets(tokenOnlyAddress, {
    readInventory: async () => verifiedInventory([]),
    readIdentity: identityReader
  });
  assert.equal(result.status, "found");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0]?.address, tokenOnlyAddress);
  assert.equal(result.results[0]?.matchedBy, "token");
  assert.deepEqual(result.results[0]?.markets, []);
}

async function assertNativeCurrencyV4Searches() {
  const identityCalls: string[] = [];
  const nativeDependencies = {
    readInventory: inventoryReader,
    readIdentity: async (address: Address) => {
      identityCalls.push(address.toLowerCase());
      return identityReader(address);
    }
  };

  const exactToken = await searchVNextUniversalMarkets(
    nativeV4TokenAddress,
    nativeDependencies
  );
  assert.equal(exactToken.status, "found");
  assert.equal(exactToken.results.length, 1);
  assert.equal(exactToken.results[0]?.address, nativeV4TokenAddress);
  assert.equal(exactToken.results[0]?.markets[0]?.token0, zeroAddress);
  assert.equal(exactToken.results[0]?.markets[0]?.token1, nativeV4TokenAddress);
  assert.equal(exactToken.results[0]?.markets[0]?.poolKey, nativeV4PoolId);
  assert.equal(exactToken.results[0]?.markets[0]?.poolAddress, null);
  assert.deepEqual(identityCalls, [nativeV4TokenAddress]);

  identityCalls.length = 0;
  const exactPool = await searchVNextUniversalMarkets(
    nativeV4PoolId,
    nativeDependencies
  );
  assert.equal(exactPool.status, "found");
  assert.equal(exactPool.results.length, 1);
  assert.equal(exactPool.results[0]?.address, nativeV4TokenAddress);
  assert.equal(exactPool.results[0]?.markets[0]?.token0, zeroAddress);
  assert.equal(exactPool.results[0]?.markets[0]?.poolKey, nativeV4PoolId);
  assert.equal(exactPool.results[0]?.markets[0]?.poolAddress, null);
  assert.deepEqual(identityCalls, [nativeV4TokenAddress]);
  assert.equal(identityCalls.includes(zeroAddress), false);
}

async function assertInvalidExactIdentitiesFailClosed() {
  let providerCalls = 0;
  const invalidDependencies = {
    ...dependencies(),
    fetch: async () => {
      providerCalls += 1;
      return jsonResponse({ pairs: [] });
    }
  };
  for (const query of [
    `0x${"0".repeat(40)}`,
    `0x${"0".repeat(64)}`,
    "0x1234",
    `0x${"g".repeat(40)}`,
    `0x${"1".repeat(63)}`
  ]) {
    const result = await searchVNextUniversalMarkets(query, invalidDependencies);
    assert.equal(result.status, "invalid_query");
  }
  assert.equal(providerCalls, 0);
}

async function assertSameIdentityContractsRemainDistinct() {
  const result = await searchVNextUniversalMarkets("SAME", dependencies([
    providerPair(sameSymbolAddressB),
    providerPair(sameSymbolAddressA)
  ]));
  assert.equal(result.status, "found");
  assert.deepEqual(result.results.map(({ address }) => address), [
    sameSymbolAddressA,
    sameSymbolAddressB
  ]);
  assert.deepEqual(result.results.map(({ name }) => name), ["Same Asset", "Same Asset"]);
}

async function assertProviderCannotCreateAuthority() {
  const pairs = [
    providerPair(stonkBrokerAddress, ROBINHOOD_WETH_ADDRESS, "ethereum"),
    providerPair("not-an-address"),
    providerPair(unrelatedAddress, ROBINHOOD_WETH_ADDRESS, "robinhood", {
      baseToken: {
        address: unrelatedAddress,
        name: "StonkBroker",
        symbol: "STONKBROKER"
      }
    }),
    providerPair("0x6666666666666666666666666666666666666666")
  ];
  const result = await searchVNextUniversalMarkets("STONKBROKER", {
    ...dependencies(pairs),
    readInventory: async () => verifiedInventory([]),
    readCanonicalCatalog: async () => ({ status: "unavailable", entries: [] })
  });
  assert.equal(result.status, "not_found");
  assert.deepEqual(result.results, []);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("fake-provider-venue"), false);
  assert.equal(serialized.includes("999999999"), false);
  assert.equal(serialized.includes("PROVIDER MUST NOT WIN"), false);
}

async function assertFailureSemantics() {
  const exactUnavailable = await searchVNextUniversalMarkets(stonkBrokerAddress, {
    readInventory: async () => ({ status: "not_configured", reason: "market_indexer_not_configured" }),
    readIdentity: identityReader,
    fetch: async () => {
      throw new Error("provider must not run");
    }
  });
  assert.equal(exactUnavailable.status, "found");
  assert.deepEqual(exactUnavailable.results[0]?.markets, []);

  let providerFailureCalls = 0;
  const providerUnavailable = await searchVNextUniversalMarkets("STONKBROKER", {
    ...dependencies(),
    fetch: async () => {
      providerFailureCalls += 1;
      return jsonResponse({}, 503);
    }
  });
  assert.equal(providerUnavailable.status, "found");
  assert.equal(providerUnavailable.results[0]?.address, stonkBrokerAddress);
  assert.equal(providerFailureCalls, 2);

  const malformedProvider = await searchVNextUniversalMarkets("STONKBROKER", {
    ...dependencies(),
    fetch: async () => jsonResponse({ wrong: [] })
  });
  assert.equal(malformedProvider.status, "found");
  assert.equal(malformedProvider.results[0]?.address, stonkBrokerAddress);

  const malformedJson = await searchVNextUniversalMarkets("STONKBROKER", {
    ...dependencies(),
    fetch: async () => new Response("not-json", { status: 200 })
  });
  assert.equal(malformedJson.status, "found");
  assert.equal(malformedJson.results[0]?.address, stonkBrokerAddress);

  const notFound = await searchVNextUniversalMarkets("MISSING", dependencies([]));
  assert.equal(notFound.status, "not_found");
}

async function assertIncompleteCoverageSemantics() {
  const incompleteReader = async (
    query: VNextCanonicalMarketInventoryQuery
  ): Promise<VNextCanonicalMarketInventoryResult> => {
    const matching = markets.filter((market) =>
      (query.token === undefined || market.token0 === query.token || market.token1 === query.token) &&
      (query.poolKey === undefined || market.poolKey === query.poolKey)
    );
    return verifiedInventory(matching.slice(0, query.limit ?? matching.length), false);
  };
  const found = await searchVNextUniversalMarkets(stonkBrokerAddress, {
    readInventory: incompleteReader,
    readIdentity: identityReader
  });
  assert.equal(found.status, "found");
  assert.equal(found.results[0]?.address, stonkBrokerAddress);

  const absentAddress = "0x9999999999999999999999999999999999999999";
  const absentIncomplete = await searchVNextUniversalMarkets(absentAddress, {
    readInventory: incompleteReader,
    readIdentity: identityReader
  });
  assert.equal(absentIncomplete.status, "inventory_unavailable");

  const absentComplete = await searchVNextUniversalMarkets(absentAddress, {
    readInventory: async () => verifiedInventory([]),
    readIdentity: identityReader
  });
  assert.equal(absentComplete.status, "not_found");

  const missingPoolId = `0x${"9".repeat(64)}`;
  const absentV4 = await searchVNextUniversalMarkets(missingPoolId, {
    readInventory: incompleteReader,
    readIdentity: identityReader
  });
  assert.equal(absentV4.status, "inventory_unavailable");

  let identityCalls = 0;
  let providerCalls = 0;
  const incompleteText = await searchVNextUniversalMarkets("STONKBROKER", {
    readInventory: incompleteReader,
    readIdentity: async (address) => {
      identityCalls += 1;
      return identityReader(address);
    },
    fetch: async () => {
      providerCalls += 1;
      return jsonResponse({ pairs: [providerPair(stonkBrokerAddress)] });
    },
    timeoutMs: 500
  });
  assert.equal(incompleteText.status, "found", "Positive canonical evidence must remain usable during incomplete backfill");
  assert.equal(incompleteText.results.length, 1);
  assert.equal(incompleteText.results[0]?.address, stonkBrokerAddress);
  assert.equal(incompleteText.results[0]?.markets.some((market) => market.poolKey === v4PoolId), true);
  assert.equal(incompleteText.results[0]?.markets.find((market) => market.poolKey === v4PoolId)?.poolAddress, null);
  assert.equal(providerCalls, 2);
  assert.equal(
    identityCalls,
    new Set(markets.flatMap((market) => [market.token0, market.token1]).filter((address) => address !== zeroAddress)).size + 2,
    "The canonical catalog must deduplicate indexed identities while both supplemental provider candidates remain independently verified"
  );

  let absentIdentityCalls = 0;
  const absentTextIncomplete = await searchVNextUniversalMarkets("MISSING", {
    readInventory: incompleteReader,
    readIdentity: async (address) => {
      absentIdentityCalls += 1;
      return identityReader(address);
    },
    fetch: providerFetch([providerPair(absentAddress, "not-an-address")]),
    timeoutMs: 500
  });
  assert.equal(absentTextIncomplete.status, "not_found");
  assert.equal(
    absentIdentityCalls,
    new Set(markets.flatMap((market) => [market.token0, market.token1]).filter((address) => address !== zeroAddress)).size + 1,
    "Canonical and supplemental candidate addresses must each receive exact onchain identity verification"
  );

  const absentTextComplete = await searchVNextUniversalMarkets("MISSING", {
    readInventory: async (query) => query.token === undefined
      ? verifiedInventory(markets.slice(0, 1))
      : verifiedInventory([]),
    readIdentity: identityReader,
    fetch: providerFetch([providerPair(absentAddress, "not-an-address")]),
    timeoutMs: 500
  });
  assert.equal(absentTextComplete.status, "not_found");

  const identityMismatch = await searchVNextUniversalMarkets("STONKBROKER", {
    readInventory: async (query) => query.token === sameSymbolAddressA
      ? verifiedInventory([sameSymbolMarketA])
      : verifiedInventory(markets.slice(0, 1)),
    readIdentity: identityReader,
    fetch: providerFetch([providerPair(sameSymbolAddressA)]),
    timeoutMs: 500,
    readCanonicalCatalog: async () => ({ status: "unavailable", entries: [] })
  });
  assert.equal(identityMismatch.status, "not_found", "Verified identity must match the text query");

  const duplicateCandidates = await searchVNextUniversalMarkets("STONKBROKER", {
    readInventory: incompleteReader,
    readIdentity: identityReader,
    fetch: providerFetch([
      providerPair(stonkBrokerAddress, "not-an-address"),
      providerPair(stonkBrokerAddress, "not-an-address")
    ]),
    timeoutMs: 500
  });
  assert.equal(duplicateCandidates.status, "found");
  assert.equal(duplicateCandidates.results.length, 1, "Duplicate provider suggestions must not duplicate verified results");
}

async function assertProviderWorkIsBounded() {
  const candidateAddresses = Array.from({ length: 40 }, (_, index) =>
    `0x${(index + 100).toString(16).padStart(40, "0")}`
  );
  let inventoryCalls = 0;
  const result = await searchVNextUniversalMarkets("BOUNDED", {
    readInventory: async () => {
      inventoryCalls += 1;
      return verifiedInventory([]);
    },
    readIdentity: async () => null,
    fetch: providerFetch(candidateAddresses.map((address) => providerPair(address))),
    timeoutMs: 500
  });
  assert.equal(result.status, "not_found");
  assert.equal(inventoryCalls, 13, "One bounded catalog page plus twelve supplemental candidates is the maximum for this fixture");
}

async function assertProviderCandidateHintsPrecedeVerificationBound() {
  const distractorAddresses = Array.from({ length: 20 }, (_, index) =>
    `0x${(index + 6_000).toString(16).padStart(40, "0")}`
  );
  const noisyPairs = distractorAddresses.map((address, index) => providerPair(
    address,
    ROBINHOOD_WETH_ADDRESS,
    "robinhood",
    {
      baseToken: {
        address,
        name: `Unrelated ${index}`,
        symbol: `WRONG${index}`
      }
    }
  ));
  const queries = [
    "STONKBROKER",
    "$STONKBROKER",
    "StonkBroker",
    "Stonk Broker",
    "Stonk-Broker",
    "Stonk_Broker",
    "StonkBrokers"
  ];

  for (const query of queries) {
    const verifiedAddresses: string[] = [];
    const result = await searchVNextUniversalMarkets(query, {
      readInventory: async (inventoryQuery) => verifiedInventory(
        inventoryQuery.token === stonkBrokerAddress ? [v4Market] : []
      ),
      readIdentity: async (address) => {
        verifiedAddresses.push(address.toLowerCase());
        return identityReader(address);
      },
      fetch: candidateFetch({
        pairs: [
          ...noisyPairs,
          providerPair(stonkBrokerAddress, ROBINHOOD_WETH_ADDRESS, "robinhood", {
            baseToken: {
              address: stonkBrokerAddress,
              name: "StonkBroker",
              symbol: "STONKBROKER"
            }
          })
        ],
        items: []
      }),
      readCanonicalCatalog: async () => ({ status: "unavailable", entries: [] }),
      searchCanonicalTokens: async () => ({ status: "unavailable", entries: [] }),
      admitProjectIdentities: async <T>(candidates: readonly T[]) => [...candidates],
      timeoutMs: 500
    });
    assert.equal(result.status, "found", query);
    assert.equal(result.results[0]?.address, stonkBrokerAddress, query);
    assert.equal(verifiedAddresses.includes(stonkBrokerAddress), true, query);
    assert.ok(verifiedAddresses.length <= 12, `${query} must preserve the final verification cap`);
  }
}

async function assertSlowHistoricalIndexCannotStarveCurrentProviderHit() {
  const startedAt = Date.now();
  const result = await searchVNextUniversalMarkets("STONKBROKER", {
    readInventory: async (inventoryQuery) => verifiedInventory(
      inventoryQuery.token === stonkBrokerAddress ? [v4Market] : []
    ),
    readIdentity: identityReader,
    fetch: candidateFetch({
      pairs: [providerPair(stonkBrokerAddress, ROBINHOOD_WETH_ADDRESS, "robinhood", {
        baseToken: {
          address: stonkBrokerAddress,
          name: "StonkBroker",
          symbol: "STONKBROKER"
        }
      })],
      items: []
    }),
    searchCanonicalTokens: async () => new Promise(() => undefined),
    readCanonicalCatalog: async () => ({ status: "unavailable", entries: [] }),
    admitProjectIdentities: async <T>(candidates: readonly T[]) => [...candidates],
    timeoutMs: 500
  });
  assert.equal(result.status, "found");
  assert.equal(result.results[0]?.address, stonkBrokerAddress);
  assert.ok(Date.now() - startedAt < 3_000, "The current provider lane must settle before the 4-second server deadline");
}

async function assertChainFilteringPrecedesCandidateBound() {
  const nonRobinhoodPairs = Array.from({ length: 35 }, (_, index) =>
    providerPair(
      `0x${(index + 1_000).toString(16).padStart(40, "0")}`,
      ROBINHOOD_WETH_ADDRESS,
      "ethereum"
    )
  );
  const result = await searchVNextUniversalMarkets("STONKBROKER", {
    ...dependencies(),
    fetch: candidateFetch({
      pairs: [...nonRobinhoodPairs, providerPair(stonkBrokerAddress)]
    })
  });
  assert.equal(result.status, "found");
  assert.equal(result.results.some(({ address }) => address === stonkBrokerAddress), true);
}

async function assertIndependentCandidateSources() {
  const unrelatedExplorerCandidates = Array.from({ length: 25 }, (_, index) =>
    blockscoutCandidate(
      `0x${(index + 2_000).toString(16).padStart(40, "0")}`,
      { name: `Other ${index}`, symbol: `OTHER${index}` }
    )
  );
  const blockscoutOnly = await searchVNextUniversalMarkets("IDENTITY", {
    readInventory: async () => verifiedInventory([]),
    readIdentity: identityReader,
    fetch: candidateFetch({
      pairs: [],
      items: [
        ...unrelatedExplorerCandidates,
        blockscoutCandidate(tokenOnlyAddress, {
          name: "Identity Only",
          symbol: "IDENTITY"
        })
      ]
    }),
    timeoutMs: 500
  });
  assert.equal(blockscoutOnly.status, "found");
  assert.equal(blockscoutOnly.results[0]?.address, tokenOnlyAddress);
  assert.deepEqual(blockscoutOnly.results[0]?.markets, []);

  const dexScreenerOnly = await searchVNextUniversalMarkets("IDENTITY", {
    readInventory: async () => verifiedInventory([]),
    readIdentity: identityReader,
    fetch: candidateFetch({ pairs: [providerPair(tokenOnlyAddress)], items: [] }),
    timeoutMs: 500
  });
  assert.equal(dexScreenerOnly.status, "found");
  assert.equal(dexScreenerOnly.results[0]?.address, tokenOnlyAddress);

  const dexScreenerDown = await searchVNextUniversalMarkets("IDENTITY", {
    readInventory: async () => verifiedInventory([]),
    readIdentity: identityReader,
    fetch: candidateFetch({
      dexStatus: 503,
      items: [blockscoutCandidate(tokenOnlyAddress)]
    }),
    timeoutMs: 500
  });
  assert.equal(dexScreenerDown.status, "found");

  const blockscoutDown = await searchVNextUniversalMarkets("IDENTITY", {
    readInventory: async () => verifiedInventory([]),
    readIdentity: identityReader,
    fetch: candidateFetch({
      pairs: [providerPair(tokenOnlyAddress)],
      blockscoutStatus: 503
    }),
    timeoutMs: 500
  });
  assert.equal(blockscoutDown.status, "found");

  const bothDown = await searchVNextUniversalMarkets("IDENTITY", {
    readInventory: async () => verifiedInventory([]),
    readIdentity: identityReader,
    fetch: candidateFetch({ dexStatus: 503, blockscoutStatus: 503 }),
    timeoutMs: 500
  });
  assert.equal(bothDown.status, "candidate_discovery_unavailable");

  const bothReadyEmpty = await searchVNextUniversalMarkets("IDENTITY", {
    readInventory: async () => verifiedInventory([]),
    readIdentity: identityReader,
    fetch: candidateFetch({ pairs: [], items: [] }),
    timeoutMs: 500
  });
  assert.equal(bothReadyEmpty.status, "not_found");

  const cases = [
    {
      name: "fast-empty DexScreener and slow-hit Blockscout",
      input: { pairs: [], items: [blockscoutCandidate(tokenOnlyAddress)], dexDelayMs: 50, blockscoutDelayMs: 300 }
    },
    {
      name: "fast-empty Blockscout and slow-hit DexScreener",
      input: { pairs: [providerPair(tokenOnlyAddress)], items: [], dexDelayMs: 300, blockscoutDelayMs: 50 }
    },
    {
      name: "fast-irrelevant DexScreener and slow-hit Blockscout",
      input: { pairs: [providerPair(unrelatedAddress)], items: [blockscoutCandidate(tokenOnlyAddress)], dexDelayMs: 50, blockscoutDelayMs: 300 }
    },
    {
      name: "fast-irrelevant Blockscout and slow-hit DexScreener",
      input: { pairs: [providerPair(tokenOnlyAddress)], items: [blockscoutCandidate(unrelatedAddress)], dexDelayMs: 300, blockscoutDelayMs: 50 }
    }
  ];

  for (const testCase of cases) {
    const startedAt = Date.now();
    const result = await searchVNextUniversalMarkets("IDENTITY", {
      readInventory: async () => verifiedInventory([]),
      readIdentity: identityReader,
      fetch: candidateFetch(testCase.input),
      timeoutMs: 500
    });
    assert.equal(result.status, "found", testCase.name);
    assert.equal(result.results[0]?.address, tokenOnlyAddress, testCase.name);
    assert.ok(Date.now() - startedAt < 500, `${testCase.name} must remain within the bounded provider deadline`);
  }
}

async function assertProviderIdentityClaimsNeverWin() {
  const result = await searchVNextUniversalMarkets("STONKBROKER", {
    readInventory: async () => verifiedInventory([]),
    readIdentity: identityReader,
    fetch: candidateFetch({
      items: [blockscoutCandidate(unrelatedAddress, {
        name: "StonkBroker",
        symbol: "STONKBROKER"
      })]
    }),
    timeoutMs: 500
  });
  assert.equal(result.status, "not_found");
  assert.deepEqual(result.results, []);
}

async function assertTimeoutIsUnavailable() {
  const result = await searchVNextUniversalMarkets("STONKBROKER", {
    ...dependencies(),
    fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }),
    timeoutMs: 250,
    readCanonicalCatalog: async () => ({ status: "unavailable", entries: [] })
  });
  assert.equal(result.status, "candidate_discovery_unavailable");
}

async function assertProjectAdmissionPrecedesPresentationAndResultBounds() {
  let exactAdmissionCalls = 0;
  const exact = await searchVNextUniversalMarkets(stonkBrokerAddress, {
    ...dependencies(),
    admitProjectIdentities: async (candidates) => {
      exactAdmissionCalls += 1;
      return candidates.filter((candidate) => candidate.address.toLowerCase() !== stonkBrokerAddress);
    }
  });
  assert.equal(exact.status, "not_admitted");
  assert.deepEqual(exact.results, []);
  assert.equal(exactAdmissionCalls, 1);

  const text = await searchVNextUniversalMarkets("STONKBROKER", {
    ...dependencies(),
    admitProjectIdentities: async (candidates) => candidates.filter(
      (candidate) => candidate.address.toLowerCase() !== stonkBrokerAddress
    )
  });
  assert.equal(text.status, "not_admitted");
  assert.deepEqual(text.results, []);
}

async function assertCanonicalInventoryIsAnIndependentTextCandidateLane() {
  const peepMarket = pool({
    sourceId: "uniswap-v2",
    protocol: "uniswap",
    version: 2,
    poolKey: peepPairAddress,
    poolAddress: peepPairAddress,
    token0: ROBINHOOD_WETH_ADDRESS.toLowerCase(),
    token1: peepAddress
  });
  const cannaCatMarket = pool({
    sourceId: "uniswap-v4",
    protocol: "uniswap",
    version: 4,
    poolKey: cannaCatPoolId,
    poolAddress: null,
    token0: zeroAddress,
    token1: cannaCatAddress,
    fee: 0,
    tickSpacing: 200,
    hooks: "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044"
  });
  const hopiumMarket = pool({
    sourceId: "uniswap-v4",
    protocol: "uniswap",
    version: 4,
    poolKey: hopiumPoolId,
    poolAddress: null,
    token0: zeroAddress,
    token1: hopiumAddress,
    fee: 0,
    tickSpacing: 200,
    hooks: "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044"
  });
  const catalog = (entries: Extract<VNextCanonicalSearchCatalog, { status: "ready" }>["entries"]): VNextCanonicalSearchCatalog => ({
    status: "ready",
    freshness: "current",
    observedAtMs: Date.now(),
    sourceManifestHash: manifestHash,
    capacity: {
      tokenCount: entries.length,
      candidateTokenCount: entries.length,
      marketCount: new Set(entries.flatMap(({ markets }) => markets.map((market) => `${market.sourceId}:${market.poolKey}`))).size,
      pageCount: 1,
      maximumTokens: 2_048,
      maximumMarkets: 4_000,
      maximumPages: 8,
      truncated: false
    },
    entries
  });
  const base = {
    readInventory: async () => verifiedInventory([]),
    readIdentity: async () => {
      throw new Error("A warmed canonical catalog must not repeat token identity reads per query.");
    },
    admitProjectIdentities: async <T>(candidates: readonly T[]) => [...candidates],
    timeoutMs: 500
  };

  const peep = await searchVNextUniversalMarkets("PEEP", {
    ...base,
    fetch: candidateFetch({ pairs: [providerPair(supplementalPeepAddress)], items: [] }),
    readIdentity: async (address) => address.toLowerCase() === supplementalPeepAddress
      ? { address, name: "PEEP Community", symbol: "PEEP", decimals: 18 }
      : null,
    readCanonicalCatalog: async () => catalog([{
      identity: { address: peepAddress, name: "PEEP", symbol: "PEEP", decimals: 18 },
      markets: [peepMarket]
    }])
  });
  assert.equal(peep.status, "found");
  assert.equal(peep.results[0]?.address, peepAddress);
  assert.equal(peep.results[0]?.markets[0]?.sourceId, "uniswap-v2");
  assert.equal(peep.results[0]?.markets[0]?.poolAddress, peepPairAddress);
  assert.equal(
    peep.results.some(({ address }) => address === supplementalPeepAddress),
    true,
    "Fast supplemental matches may remain visible without outranking exact canonical market evidence"
  );

  const globalDistractors = Array.from({ length: 24 }, (_, index) => providerPair(
    `0x${(index + 4_000).toString(16).padStart(40, "0")}`,
    ROBINHOOD_WETH_ADDRESS,
    "ethereum"
  ));
  const cannaCat = await searchVNextUniversalMarkets("CANNACAT", {
    ...base,
    fetch: candidateFetch({
      pairs: globalDistractors,
      items: Array.from({ length: 24 }, (_, index) => blockscoutCandidate(
        `0x${(index + 5_000).toString(16).padStart(40, "0")}`,
        { name: `Distractor ${index}`, symbol: `WRONG${index}` }
      ))
    }),
    readCanonicalCatalog: async () => catalog([{
      identity: { address: cannaCatAddress, name: "CannaCat", symbol: "CANNACAT", decimals: 18 },
      markets: [cannaCatMarket]
    }])
  });
  assert.equal(cannaCat.status, "found");
  assert.equal(cannaCat.results[0]?.markets[0]?.poolKey, cannaCatPoolId);
  assert.equal(cannaCat.results[0]?.markets[0]?.poolAddress, null);
  assert.equal(cannaCat.results[0]?.markets[0]?.token0, zeroAddress);

  const hopium = await searchVNextUniversalMarkets("HOPIUM", {
    ...base,
    fetch: candidateFetch({
      pairs: [],
      items: [{
        type: "token",
        token_type: "ERC-721",
        address_hash: unrelatedAddress,
        name: "Hopium Machines",
        symbol: "HOPIUM"
      }]
    }),
    readCanonicalCatalog: async () => catalog([{
      identity: { address: hopiumAddress, name: "Hopium Machines", symbol: "HOPIUM", decimals: 18 },
      markets: [hopiumMarket]
    }])
  });
  assert.equal(hopium.status, "found");
  assert.equal(hopium.results[0]?.address, hopiumAddress);
  assert.equal(hopium.results[0]?.markets[0]?.sourceId, "uniswap-v4");
  assert.equal(hopium.results[0]?.markets[0]?.poolKey, hopiumPoolId);

  const duplicateSymbol = await searchVNextUniversalMarkets("SAME", {
    ...base,
    fetch: candidateFetch({ pairs: [], items: [] }),
    readCanonicalCatalog: async () => catalog([
      { identity: identities.get(sameSymbolAddressA)!, markets: [sameSymbolMarketA] },
      { identity: identities.get(sameSymbolAddressB)!, markets: [sameSymbolMarketB] }
    ])
  });
  assert.deepEqual(duplicateSymbol.results.map(({ address }) => address), [sameSymbolAddressA, sameSymbolAddressB]);
}

async function assertCanonicalSearchSurvivesTheRetiredCatalogBounds() {
  const afterOldLimitAddress = "0x0000000000000000000000000000000000000801";
  const firstPageAddress = "0x0000000000000000000000000000000000000001";
  const afterOldLimitMarket = pool({
    sourceId: "uniswap-v4",
    protocol: "uniswap",
    version: 4,
    poolKey: `0x${"9".repeat(64)}`,
    poolAddress: null,
    token0: zeroAddress,
    token1: afterOldLimitAddress,
    fee: 0,
    tickSpacing: 200,
    hooks: zeroAddress
  });
  const firstPageMarket = pool({
    sourceId: "uniswap-v2",
    protocol: "uniswap",
    version: 2,
    poolKey: "0x0000000000000000000000000000000000001001",
    poolAddress: "0x0000000000000000000000000000000000001001",
    token0: firstPageAddress,
    token1: ROBINHOOD_WETH_ADDRESS.toLowerCase()
  });
  const indexedEntries = [
    {
      address: afterOldLimitAddress,
      name: "After Old Boundary",
      symbol: "POSTBOUND",
      decimals: 18,
      totalSupply: "1000000000000000000",
      markets: [afterOldLimitMarket]
    },
    {
      address: firstPageAddress,
      name: "First Page Control",
      symbol: "FIRSTPAGE",
      decimals: 18,
      totalSupply: "1000000000000000000",
      markets: [firstPageMarket]
    }
  ];
  const capacity = {
    totalCanonicalMarkets: 4_001,
    totalUniqueCanonicalTokens: 2_049,
    totalVerifiedErc20Identities: 2_049,
    indexedSearchTokenIdentities: 2_049,
    unresolvedTokenIdentities: 0,
    complete: true
  };
  const searchCanonicalTokens = async (query: string) => ({
    status: "ready" as const,
    sourceManifestHash: manifestHash,
    coverageComplete: true,
    capacity,
    entries: indexedEntries.filter((entry) =>
      [entry.name, entry.symbol].some((value) =>
        value.toLowerCase().replace(/[\s_-]+/g, "") === query.toLowerCase().replace(/[\s_-]+/g, "")
      )
    )
  });
  const common: VNextUniversalMarketSearchDependencies = {
    readInventory: async () => verifiedInventory([]),
    readIdentity: async () => null,
    fetch: candidateFetch({ pairs: [], items: [] }),
    searchCanonicalTokens,
    admitProjectIdentities: async <T>(candidates: readonly T[]) => [...candidates],
    timeoutMs: 500
  };
  for (const query of ["POSTBOUND", "After Old Boundary", "after-old_boundary"]) {
    const result = await searchVNextUniversalMarkets(query, common);
    assert.equal(result.status, "found", query);
    assert.equal(result.results[0]?.address, afterOldLimitAddress, query);
    assert.equal(result.results[0]?.markets[0]?.poolKey, afterOldLimitMarket.poolKey, query);
  }
  const first = await searchVNextUniversalMarkets("FIRSTPAGE", common);
  assert.equal(first.results[0]?.address, firstPageAddress);
}

async function main() {
  await assertStonkBrokerTextSearches();
  await assertExactSearchesNeverUseProvider();
  await assertTokenOnlyExactIdentityIsFound();
  await assertNativeCurrencyV4Searches();
  await assertInvalidExactIdentitiesFailClosed();
  await assertSameIdentityContractsRemainDistinct();
  await assertProviderCannotCreateAuthority();
  await assertFailureSemantics();
  await assertIncompleteCoverageSemantics();
  await assertProviderWorkIsBounded();
  await assertProviderCandidateHintsPrecedeVerificationBound();
  await assertSlowHistoricalIndexCannotStarveCurrentProviderHit();
  await assertChainFilteringPrecedesCandidateBound();
  await assertIndependentCandidateSources();
  await assertProviderIdentityClaimsNeverWin();
  await assertTimeoutIsUnavailable();
  await assertProjectAdmissionPrecedesPresentationAndResultBounds();
  await assertCanonicalInventoryIsAnIndependentTextCandidateLane();
  await assertCanonicalSearchSurvivesTheRetiredCatalogBounds();

  console.log(
    "Universal market search preserves first-party inventory and onchain identity authority across exact and bounded text queries."
  );
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
