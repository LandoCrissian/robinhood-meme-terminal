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

const stonkBrokerAddress = "0xe934e36a439c94017b64a3fece66af12099abf50";
const sameSymbolAddressA = "0x1111111111111111111111111111111111111111";
const sameSymbolAddressB = "0x2222222222222222222222222222222222222222";
const unrelatedAddress = "0x3333333333333333333333333333333333333333";
const v2PoolAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const v3PoolAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const v4PoolId = `0x${"c".repeat(64)}`;
const nativeV4PoolId = `0x${"d".repeat(64)}`;
const nativeV4TokenAddress = "0x7777777777777777777777777777777777777777";
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
    assert.equal(url.origin + url.pathname, "https://api.dexscreener.com/latest/dex/search");
    assert.ok(url.searchParams.has("q"));
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("Accept"), "application/json");
    assert.equal(init?.cache, "no-store");
    return jsonResponse({ pairs });
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
  }

  const v4 = await searchVNextUniversalMarkets(v4PoolId, exactDependencies);
  assert.equal(v4.status, "found");
  assert.equal(v4.results[0]?.address, stonkBrokerAddress);
  assert.equal(v4.results[0]?.matchedBy, "pool-id");
  assert.equal(v4.results[0]?.markets[0]?.poolAddress, null);
  assert.equal(v4.results[0]?.markets[0]?.poolKey, v4PoolId);
  assert.equal(providerCalls, 0);
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
  const result = await searchVNextUniversalMarkets("STONKBROKER", dependencies(pairs));
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
  assert.equal(exactUnavailable.status, "inventory_unavailable");

  let providerFailureCalls = 0;
  const providerUnavailable = await searchVNextUniversalMarkets("STONKBROKER", {
    ...dependencies(),
    fetch: async () => {
      providerFailureCalls += 1;
      return jsonResponse({}, 503);
    }
  });
  assert.equal(providerUnavailable.status, "candidate_discovery_unavailable");
  assert.equal(providerFailureCalls, 1);

  const malformedProvider = await searchVNextUniversalMarkets("STONKBROKER", {
    ...dependencies(),
    fetch: async () => jsonResponse({ wrong: [] })
  });
  assert.equal(malformedProvider.status, "candidate_discovery_unavailable");

  const malformedJson = await searchVNextUniversalMarkets("STONKBROKER", {
    ...dependencies(),
    fetch: async () => new Response("not-json", { status: 200 })
  });
  assert.equal(malformedJson.status, "candidate_discovery_unavailable");

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
  assert.equal(providerCalls, 1);
  assert.equal(identityCalls, 2, "Both canonically indexed sides of the provider pair may receive identity verification");

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
  assert.equal(absentTextIncomplete.status, "inventory_unavailable");
  assert.equal(absentIdentityCalls, 0, "Provider-only candidates must not trigger identity authority without canonical evidence");

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
    timeoutMs: 500
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
  assert.equal(inventoryCalls, 13);
}

async function assertTimeoutIsUnavailable() {
  const result = await searchVNextUniversalMarkets("STONKBROKER", {
    ...dependencies(),
    fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }),
    timeoutMs: 250
  });
  assert.equal(result.status, "candidate_discovery_unavailable");
}

async function main() {
  await assertStonkBrokerTextSearches();
  await assertExactSearchesNeverUseProvider();
  await assertNativeCurrencyV4Searches();
  await assertInvalidExactIdentitiesFailClosed();
  await assertSameIdentityContractsRemainDistinct();
  await assertProviderCannotCreateAuthority();
  await assertFailureSemantics();
  await assertIncompleteCoverageSemantics();
  await assertProviderWorkIsBounded();
  await assertTimeoutIsUnavailable();

  console.log(
    "Universal market search preserves first-party inventory and onchain identity authority across exact and bounded text queries."
  );
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
