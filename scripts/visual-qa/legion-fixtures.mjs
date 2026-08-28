export const FIXTURE_NOW = "2026-08-28T12:00:00.000Z";
export const FIXTURE_EPOCH_MS = Date.parse(FIXTURE_NOW);
export const CCFF00_COLLECTION = "0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146";
export const FIXTURE_OWNER = "0x1111111111111111111111111111111111111111";
export const FIXTURE_BUYER = "0x2222222222222222222222222222222222222222";
export const FIXTURE_TBA = "0x3333333333333333333333333333333333333333";
export const FIXTURE_HASH = `0x${"1".repeat(64)}`;
export const SEAPORT_1_6 = "0x0000000000000068F116a894984e2DB1123eB395";

const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

const definitions = [
  { name: "STONKBROKER", symbol: "STONKBROKER", token: "0xe934e36a439c94017b64a3fece66af12099abf50", sourceId: "uniswap-v4", version: 4, poolKey: "0xd33c8fd38b06e989cdbd4dffdefab71c4bdd415b24964c8d69e38ff35b068f92", poolAddress: null, tokenFirst: false, fee: 10_000, hooks: "0x0000000000000000000000000000000000000000" },
  { name: "PONS", symbol: "PONS", token: "0x39dbed3a2bd333467115de45665cc57f813c4571", sourceId: "uniswap-v3", version: 3, poolKey: "0x10cc6bd38112cac182db90b6a71d8bb5939526ba", poolAddress: "0x10cc6bd38112cac182db90b6a71d8bb5939526ba" },
  { name: "PIPEDOG", symbol: "PIPEDOG", token: "0x5cb6f181081301b44905f3ae15419112ecabd8a6", sourceId: "uniswap-v3", version: 3, poolKey: "0xb7f10f74b39291b9290b779978e19a7637c742d6", poolAddress: "0xb7f10f74b39291b9290b779978e19a7637c742d6" },
  { name: "CASHCAT", symbol: "CASHCAT", token: "0x020bfc650a365f8bb26819deaabf3e21291018b4", sourceId: "uniswap-v3", version: 3, poolKey: "0xa70fc67c9f69da90b63a0e4c05d229954574e313", poolAddress: "0xa70fc67c9f69da90b63a0e4c05d229954574e313" },
  { name: "LEMON.FUN", symbol: "LEMON", token: "0xf0e17e54239cd945cd7bea471a3a2ca6a8c7f7a3", sourceId: "uniswap-v3", version: 3, poolKey: "0x01fe057d1c5fb09a4ac02860758ddf26df9336b5", poolAddress: "0x01fe057d1c5fb09a4ac02860758ddf26df9336b5" },
  { name: "PEEP", symbol: "PEEP", token: "0xf0821f2bf570ca4e7499a9ed9db7c788fed9946f", sourceId: "uniswap-v2", version: 2, poolKey: "0xe70dd15481ba143f145fbe23e8916236d554d3c7", poolAddress: "0xe70dd15481ba143f145fbe23e8916236d554d3c7" },
  { name: "HOPIUM", symbol: "HOPIUM", token: "0xb6ce51925c2e397ebf1a443b343d19267b3d4225", sourceId: "uniswap-v4", version: 4, poolKey: "0xc1dbd75280b6d117b4ac1e27fcd00c6dccb1a2b2fbfa9923a2c492711299d337", poolAddress: null },
  { name: "CANNACAT", symbol: "CANNACAT", token: "0x1139d423c1706bdead91f03507f521635591ed92", sourceId: "uniswap-v4", version: 4, poolKey: "0x5f5ec0e1016bae2f04c122bbcd2c141a4177cc681d7c2e4463a1d172ed8430b3", poolAddress: null },
];

function canonicalMarket(definition, index) {
  const v4 = definition.version === 4;
  const tokenFirst = definition.tokenFirst ?? index === 3;
  return {
    sourceId: definition.sourceId,
    protocol: "uniswap",
    version: definition.version,
    poolKey: definition.poolKey,
    poolAddress: definition.poolAddress,
    token0: v4 ? "0x0000000000000000000000000000000000000000" : tokenFirst ? definition.token : WETH.toLowerCase(),
    token1: v4 || !tokenFirst ? definition.token : WETH.toLowerCase(),
    stable: null,
    fee: definition.version === 2 ? null : definition.fee ?? 10_000,
    tickSpacing: definition.version === 2 ? null : 200,
    hooks: definition.version === 4 ? (definition.hooks ?? "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044") : null,
    transactionHash: `0x${String(index + 2).repeat(64).slice(0, 64)}`,
    blockNumber: String(12_670_814 + index),
    blockHash: `0x${String(index + 3).repeat(64).slice(0, 64)}`,
    stateStatus: null, liveFee: null, feeDenominator: null,
    gaugeAddress: null, gaugeAlive: null, gaugeWeight: null, gaugeClaimable: null,
    feesAddress: null, bribeAddress: null, stateObservedBlock: null, stateObservedBlockHash: null,
  };
}

export const TOKEN_MARKETS = definitions.map((definition, index) => {
  const priceUsd = [0.001842, 0.000092, 0.00831, 0.000441, 0.0248, 0.0000162, 0.00377, 0.000815][index];
  const change = [8.4, 3.1, -2.2, 1.8, 6.7, -0.9, 4.5, 2.6][index];
  const pool = canonicalMarket(definition, index);
  const assetId = `eip155:4663/contract:${definition.token}`;
  const evidence = {
    chainId: 4663,
    assetId,
    token: { address: definition.token, name: definition.name, symbol: definition.symbol },
    venue: definition.sourceId,
    protocolVersion: definition.version,
    pool: { kind: definition.version === 4 ? "bytes32" : "evm-address", value: definition.poolKey },
    baseToken: { address: definition.token, name: definition.name, symbol: definition.symbol },
    quoteToken: { address: WETH, name: "Wrapped Ether", symbol: "WETH" },
    assetSide: "BASE",
    displayEligibility: "eligible",
    chartEligibility: definition.version === 4 ? "unavailable" : "eligible",
    executionEligibility: "view-only",
    provenance: "legion-deterministic-fixture",
    priceUsd,
    liquidityUsd: 90_000 + index * 31_000,
    marketCapUsd: 620_000 + index * 290_000,
    fdvUsd: 710_000 + index * 330_000,
    volume24h: 410_000 + index * 97_000,
    priceChange24h: change,
    pairCreatedAt: FIXTURE_EPOCH_MS - (index + 30) * 86_400_000,
  };
  return {
    assetId,
    address: definition.token,
    name: definition.name,
    symbol: definition.symbol,
    pairAddress: definition.poolAddress ?? definition.poolKey,
    url: `https://robinhoodchain.blockscout.com/${definition.poolAddress ? "address" : "tx"}/${definition.poolAddress ?? pool.transactionHash}`,
    dexId: definition.sourceId,
    project: null,
    socials: { x: null, telegram: null, discord: null, website: null, farcaster: null, provenance: "none" },
    origin: { kind: "external", state: "unattributed", sourceId: null, sourceName: null, coverage: "complete", claim: null },
    venue: { kind: "dex", dexId: definition.sourceId, pairAddress: definition.poolAddress, url: null, execution: "read-only" },
    priceUsd,
    liquidityUsd: evidence.liquidityUsd,
    marketCapUsd: evidence.marketCapUsd,
    fdvUsd: evidence.fdvUsd,
    volume5m: 4_500 + index * 510,
    volume1h: 45_000 + index * 4_900,
    volume24h: evidence.volume24h,
    priceChange5m: change / 4,
    priceChange1h: change / 2,
    priceChange24h: change,
    buys5m: 24 + index, sells5m: 11 + index, buys1h: 140 + index * 7, sells1h: 78 + index * 5,
    buys24h: 1_100 + index * 83, sells24h: 650 + index * 61,
    pairCreatedAt: evidence.pairCreatedAt,
    ageMinutes: 43_200 + index * 1_440,
    momentumScore: 55 + index,
    buyPressureBps: 6_100 + index * 90,
    signal: "active",
    riskFlags: [],
    primaryMarket: evidence,
    verifiedMarkets: [evidence],
    canonicalMarkets: [pool],
    stockAssetRelationships: [],
  };
});

export function canonicalDirectoryMarkets() {
  return TOKEN_MARKETS.map((market) => ({
    address: market.address, assetId: market.assetId, name: market.name, symbol: market.symbol,
    priceUsd: null, liquidityUsd: null, marketCapUsd: null, volume5m: null, volume1h: null,
    volume24h: null, priceChange5m: null, priceChange1h: null, priceChange24h: null,
    buys5m: null, sells5m: null, buys1h: null, sells1h: null, buys24h: null, sells24h: null,
    pairCreatedAt: null, ageMinutes: null, momentumScore: null, buyPressureBps: null,
    riskFlags: null, signal: null, stockAssetRelationships: [], canonicalMarkets: market.canonicalMarkets,
  }));
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#CCFF00"/></svg>`;
export const CCFF00_IMAGE = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
export const CCFF00_METADATA = {
  authority: "ONCHAIN_TOKEN_URI", status: "READY", tokenUriKind: "DATA_JSON_BASE64",
  name: "#CCFF00", description: "This is Robin Neon.", image: CCFF00_IMAGE,
  attributes: [{ traitType: "Color", value: "#CCFF00" }], metadataDigest: FIXTURE_HASH,
};

export function nftInventory(limit = 24) {
  const count = Math.min(limit, 24);
  return {
    schemaVersion: 1, projectId: "ccff00", chainId: 4663, collectionAddress: CCFF00_COLLECTION,
    collectionStandard: "ERC721", availability: "AVAILABLE", availabilityReason: null, asOf: FIXTURE_NOW,
    items: Array.from({ length: count }, (_, index) => ({ tokenId: String(index + 1), owner: FIXTURE_OWNER, metadata: CCFF00_METADATA })),
    nextCursor: count < 24 ? String(count) : null,
  };
}

export const NFT_ITEM = {
  schemaVersion: 1, projectId: "ccff00", chainId: 4663, collectionAddress: CCFF00_COLLECTION,
  collectionStandard: "ERC721", tokenId: "1", owner: FIXTURE_OWNER, metadata: CCFF00_METADATA, asOf: FIXTURE_NOW,
  tokenBoundAccount: { authority: "ONCHAIN_ERC6551_ACCOUNT", chainId: 4663, collectionAddress: CCFF00_COLLECTION, tokenId: "1", accountAddress: FIXTURE_TBA },
};

export const NFT_ONCHAIN = {
  schemaVersion: 1, projectId: "ccff00", chainId: 4663, collectionAddress: CCFF00_COLLECTION,
  collectionStandard: "ERC721", sourceStatus: "SYNCED", availability: "AVAILABLE", completeness: "COMPLETE",
  holderCount: "9750", circulatingTokenCount: "9750", asOf: FIXTURE_NOW,
  recentActivity: [{ transactionHash: FIXTURE_HASH, blockNumber: "10929152", blockHash: FIXTURE_HASH,
    logIndex: 1, movementIndex: 0, kind: "TRANSFER", from: FIXTURE_OWNER, to: FIXTURE_BUYER,
    tokenId: "1", amount: "1", marketMeaning: "NOT_ESTABLISHED" }],
};

export const NFT_MARKETPLACE = {
  schemaVersion: 1, projectId: "ccff00", chainId: 4663, collectionAddress: CCFF00_COLLECTION,
  provider: "OPENSEA", protocol: "SEAPORT_1_6", availability: "AVAILABLE", availabilityReason: null,
  sourceStatus: "SYNCED", identityScope: "EXACT_CONTRACT_SCOPE", providerCollectionSlug: "ccff00-161927574", asOf: FIXTURE_NOW,
  lowestNormalizedListing: { authority: "LOWEST_NORMALIZED_OPENSEA_LISTING", rmtExecutable: false, orderHash: FIXTURE_HASH,
    protocolAddress: SEAPORT_1_6, tokenId: "1", quantity: "1", grossAmount: "1000000000000000000",
    paymentAsset: { kind: "NATIVE", chainId: 4663, address: null, symbol: "ETH", decimals: 18 }, maker: FIXTURE_OWNER, exactRevalidatedAt: FIXTURE_NOW },
  recentProviderSales: [{ authority: "PROVIDER_REPORTED_SALE", settlementVerificationStatus: "NOT_VERIFIED",
    tokenId: "1", quantity: "1", seller: FIXTURE_OWNER, buyer: FIXTURE_BUYER, paymentAsset: null,
    grossAmount: null, transactionHash: null, orderHash: null, eventTimestamp: FIXTURE_NOW }],
  volume24hByPaymentAsset: [{ authority: "OPENSEA_REPORTED_24H_VOLUME",
    paymentAsset: { kind: "NATIVE", chainId: 4663, address: null, symbol: "ETH", decimals: 18 }, grossAmount: "1000000000000000000", saleCount: 1 }],
};
