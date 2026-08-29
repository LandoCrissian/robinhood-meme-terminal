export const FIXTURE_NOW = "2026-08-28T12:00:00.000Z";
export const FIXTURE_EPOCH_MS = Date.parse(FIXTURE_NOW);
export const CCFF00_COLLECTION = "0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146";
export const FIXTURE_OWNER = "0x1111111111111111111111111111111111111111";
export const FIXTURE_BUYER = "0x2222222222222222222222222222222222222222";
export const FIXTURE_TBA = "0x3333333333333333333333333333333333333333";
export const FIXTURE_HASH = `0x${"1".repeat(64)}`;
export const SEAPORT_1_6 = "0x0000000000000068F116a894984e2DB1123eB395";
export const RADAR_DROP_COLLECTION = "0x4444444444444444444444444444444444444444";
export const RADAR_SEADROP = "0x5555555555555555555555555555555555555555";
export const RADAR_SEADROP_CODE = "0x60016000";
export const RADAR_SEADROP_RUNTIME_HASH = "0xcf61a6eb3b9b89e75f1dadf3dcd16509616896cb50eac765a68fa27bbbc6de82";

const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const V4_HOOKS = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044";

const radarStage = (name, start, end, label = "Public") => ({
  uuid: `legion-${name}`,
  stage_type: "public_sale",
  label,
  price: "12500000000000000",
  price_currency_address: ZERO_ADDRESS,
  start_time: start,
  end_time: end,
  max_per_wallet: "2",
});

const radarDrop = (slug, name, overrides) => ({
  collection_slug: slug,
  collection_name: name,
  chain: "robinhood",
  contract_address: "provider-contract-not-established",
  drop_type: "seadrop_v1_erc721",
  is_minting: false,
  image_url: "https://example.invalid/media-is-intentionally-not-rendered.png",
  opensea_url: `https://opensea.io/collection/${slug}`,
  active_stage: null,
  next_stage: null,
  ...overrides,
});

export const NFT_MINT_RADAR_PAGES = {
  featured: { drops: [radarDrop("legion-live", "Neon Assembly", {
    is_minting: true,
    active_stage: radarStage("live", "2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"),
  })], next: null },
  upcoming: { drops: [
    radarDrop("legion-upcoming-one", "Robinhood Relics", { contract_address: RADAR_DROP_COLLECTION, next_stage: radarStage("upcoming-one", "2026-09-15T16:00:00.000Z", "2026-09-15T18:00:00.000Z", "CCFF00 Gate") }),
    radarDrop("legion-upcoming-two", "Terminal Studies", { next_stage: radarStage("upcoming-two", "2026-09-20T20:00:00.000Z", "2026-09-20T23:00:00.000Z") }),
  ], next: null },
  recently_minted: { drops: [radarDrop("legion-recent", "Chain Impressions", {
    active_stage: radarStage("recent", "2026-08-15T09:00:00.000Z", "2026-08-15T10:00:00.000Z"),
  })], next: null },
};

export const NFT_MINT_RADAR_DETAILS = Object.fromEntries(Object.values(NFT_MINT_RADAR_PAGES).flatMap(({ drops }) => drops).map((drop) => {
  const stages = [drop.active_stage, drop.next_stage].filter(Boolean);
  return [drop.collection_slug, {
    collection_slug: drop.collection_slug,
    collection_name: drop.collection_name,
    chain: drop.chain,
    contract_address: drop.contract_address,
    drop_type: drop.drop_type,
    is_minting: drop.is_minting,
    active_stage: drop.active_stage,
    next_stage: drop.next_stage,
    stages,
    total_supply: "24",
    max_supply: "1000",
  }];
}));

const definitions = [
  { name: "STONKBROKER", symbol: "STONKBROKER", token: "0xe934e36a439c94017b64a3fece66af12099abf50", sourceId: "uniswap-v4", version: 4, poolKey: "0xd33c8fd38b06e989cdbd4dffdefab71c4bdd415b24964c8d69e38ff35b068f92", poolAddress: null, token0: ZERO_ADDRESS, token1: "0xe934e36a439c94017b64a3fece66af12099abf50", fee: 10_000, tickSpacing: 200, hooks: ZERO_ADDRESS, transactionHash: "0xd5c74c05e885ec3feed94ccbbc465ab91d687d7660692297011e49676f50e719", blockNumber: "12670814", blockHash: "0x8105c0eb7bcb8790e8ceee10dc56676148b648a7d6270463e04755429190bab9" },
  { name: "PONS", symbol: "PONS", token: "0x39dbed3a2bd333467115de45665cc57f813c4571", sourceId: "uniswap-v3", version: 3, poolKey: "0x10cc6bd38112cac182db90b6a71d8bb5939526ba", poolAddress: "0x10cc6bd38112cac182db90b6a71d8bb5939526ba", token0: WETH, token1: "0x39dbed3a2bd333467115de45665cc57f813c4571", fee: 10_000, tickSpacing: 200, hooks: null, transactionHash: "0x1f54f25fec2d963dcb338ecb8b46a6eb123198a5c7a746d34cb2dbe78d074af8", blockNumber: "8963150", blockHash: "0xd18718d02fe1da449333e477bc588a41e59b1fd169a2b945a14fb17339d684a3" },
  { name: "PIPEDOG", symbol: "PIPEDOG", token: "0x5cb6f181081301b44905f3ae15419112ecabd8a6", sourceId: "uniswap-v3", version: 3, poolKey: "0xb7f10f74b39291b9290b779978e19a7637c742d6", poolAddress: "0xb7f10f74b39291b9290b779978e19a7637c742d6", token0: WETH, token1: "0x5cb6f181081301b44905f3ae15419112ecabd8a6", fee: 10_000, tickSpacing: 200, hooks: null, transactionHash: "0x0abd4002d4a56e982ca813b486ceb16a0b5b97b49c95c1e58a78e6b29d83cab8", blockNumber: "21881211", blockHash: "0xab2e50c0111dc7c4461ff7cda76a924e29f32b9df19b27147b34463c6fab9118" },
  { name: "CASHCAT", symbol: "CASHCAT", token: "0x020bfc650a365f8bb26819deaabf3e21291018b4", sourceId: "uniswap-v3", version: 3, poolKey: "0xa70fc67c9f69da90b63a0e4c05d229954574e313", poolAddress: "0xa70fc67c9f69da90b63a0e4c05d229954574e313", token0: "0x020bfc650a365f8bb26819deaabf3e21291018b4", token1: WETH, fee: 10_000, tickSpacing: 200, hooks: null, transactionHash: "0x0e6d23f0babd02ede4aefaa923486591d783e1180c277c71e2f2a39fc74a4661", blockNumber: "88836", blockHash: "0x5f7080d69cf24611a084a9c10196eabc148779ad8dd43a2a983aefdd17ab3fc6" },
  { name: "LEMON.FUN", symbol: "LEMON", token: "0xf0e17e54239cd945cd7bea471a3a2ca6a8c7f7a3", sourceId: "uniswap-v3", version: 3, poolKey: "0x01fe057d1c5fb09a4ac02860758ddf26df9336b5", poolAddress: "0x01fe057d1c5fb09a4ac02860758ddf26df9336b5", token0: WETH, token1: "0xf0e17e54239cd945cd7bea471a3a2ca6a8c7f7a3", fee: 10_000, tickSpacing: 200, hooks: null, transactionHash: "0x48a82224ef11e3b49902c03f962bb64a74fd828b843774a18883c31e0759104d", blockNumber: "19020802", blockHash: "0xe265c314d348c67a572b14dd91c570745363f4ca2493ff309128a7ce9315d0fd" },
  { name: "PEEP", symbol: "PEEP", token: "0xf0821f2bf570ca4e7499a9ed9db7c788fed9946f", sourceId: "uniswap-v2", version: 2, poolKey: "0xe70dd15481ba143f145fbe23e8916236d554d3c7", poolAddress: "0xe70dd15481ba143f145fbe23e8916236d554d3c7", token0: WETH, token1: "0xf0821f2bf570ca4e7499a9ed9db7c788fed9946f", fee: null, tickSpacing: null, hooks: null, transactionHash: "0xf7a26164fd139670f67ca05eef8cb7bc9bf07fd073c9385a2ba8cd5a52a4fe38", blockNumber: "9711277", blockHash: "0x5c884a41f8073cc5df3c915ec610e7f77fbb7889870d52f46f8ab6956201ab32" },
  { name: "HOPIUM", symbol: "HOPIUM", token: "0xb6ce51925c2e397ebf1a443b343d19267b3d4225", sourceId: "uniswap-v4", version: 4, poolKey: "0xc1dbd75280b6d117b4ac1e27fcd00c6dccb1a2b2fbfa9923a2c492711299d337", poolAddress: null, token0: ZERO_ADDRESS, token1: "0xb6ce51925c2e397ebf1a443b343d19267b3d4225", fee: 0, tickSpacing: 200, hooks: V4_HOOKS, transactionHash: "0x82b7d0771002e7b6ed257445dd4f34f051408165ed8e64762c8980af397611ef", blockNumber: "46294063", blockHash: "0xaf1b3a61caf6515d5ad7f7a48a97d8ec0d0f0a3cd1224cebc214f990708a0578" },
  { name: "CANNACAT", symbol: "CANNACAT", token: "0x1139d423c1706bdead91f03507f521635591ed92", sourceId: "uniswap-v4", version: 4, poolKey: "0x5f5ec0e1016bae2f04c122bbcd2c141a4177cc681d7c2e4463a1d172ed8430b3", poolAddress: null, token0: ZERO_ADDRESS, token1: "0x1139d423c1706bdead91f03507f521635591ed92", fee: 0, tickSpacing: 200, hooks: V4_HOOKS, transactionHash: "0x239660e071411e86da99eaad2f5bbe1427b40fae6868ce21475ef34f009994a9", blockNumber: "44544646", blockHash: "0x10582df74469058a95c64ea407d853cd640cf2d9365d12154e3f57da9f995788" },
];

function canonicalMarket(definition) {
  return {
    sourceId: definition.sourceId,
    protocol: "uniswap",
    version: definition.version,
    poolKey: definition.poolKey,
    poolAddress: definition.poolAddress,
    token0: definition.token0.toLowerCase(),
    token1: definition.token1.toLowerCase(),
    stable: null,
    fee: definition.fee,
    tickSpacing: definition.tickSpacing,
    hooks: definition.hooks,
    transactionHash: definition.transactionHash,
    blockNumber: definition.blockNumber,
    blockHash: definition.blockHash,
    stateStatus: null, liveFee: null, feeDenominator: null,
    gaugeAddress: null, gaugeAlive: null, gaugeWeight: null, gaugeClaimable: null,
    feesAddress: null, bribeAddress: null, stateObservedBlock: null, stateObservedBlockHash: null,
  };
}

export const TOKEN_MARKETS = definitions.map((definition, index) => {
  // Rendering economics are deterministic test-only values; definitions above are canonical repository authority.
  const priceUsd = [0.001842, 0.000092, 0.00831, 0.000441, 0.0248, 0.0000162, 0.00377, 0.000815][index];
  const change = [8.4, 3.1, -2.2, 1.8, 6.7, -0.9, 4.5, 2.6][index];
  const pool = canonicalMarket(definition);
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
    marketCapUsd: index === 6 ? null : 620_000 + index * 290_000,
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

const broadDefinitions = [
  { name: "V2 RUNNER", symbol: "V2RUN", token: "0x6000000000000000000000000000000000000001", pair: "0x7000000000000000000000000000000000000001", dexId: "uniswap-v2", version: 2, execution: "EXECUTION_ELIGIBLE_V2", ageMinutes: 180, signal: "moving", activity: true },
  { name: "V3 DEPTH", symbol: "V3DEPTH", token: "0x6000000000000000000000000000000000000002", pair: "0x7000000000000000000000000000000000000002", dexId: "uniswap-v3", version: 3, execution: "EXECUTION_ELIGIBLE_V3", ageMinutes: 6_000, signal: "active", activity: true },
  { name: "V4 OBSERVED", symbol: "V4VIEW", token: "0x6000000000000000000000000000000000000003", pair: "0x7000000000000000000000000000000000000003", dexId: "uniswap-v4", version: 4, execution: "EXECUTION_UNAVAILABLE", ageMinutes: 2_400, signal: null, activity: false },
  { name: "OTHER DEX", symbol: "OTHER", token: "0x6000000000000000000000000000000000000004", pair: "0x7000000000000000000000000000000000000004", dexId: "observed-dex", version: 2, execution: "EXECUTION_UNAVAILABLE", ageMinutes: 8_000, signal: null, activity: true },
  { name: "HELD OBSERVED", symbol: "HELDX", token: "0x6000000000000000000000000000000000000005", pair: "0x7000000000000000000000000000000000000005", dexId: "uniswap-v2", version: 2, execution: "EXECUTION_ELIGIBLE_V2", ageMinutes: 12_000, signal: null, activity: false, held: true },
  { name: "PARTIAL DATA", symbol: "PARTIAL", token: "0x6000000000000000000000000000000000000006", pair: "0x7000000000000000000000000000000000000006", dexId: "uniswap-v3", version: 3, execution: "EXECUTION_ELIGIBLE_V3", ageMinutes: 20_000, signal: null, activity: false, partial: true },
];

export const BROAD_TOKEN_MARKETS = broadDefinitions.map((definition, index) => {
  const assetId = `eip155:4663/contract:${definition.token}`;
  const evidence = {
    chainId: 4663,
    assetId,
    token: { address: definition.token, name: definition.name, symbol: definition.symbol },
    venue: definition.dexId,
    protocolVersion: definition.version,
    pool: { kind: "evm-address", value: definition.pair },
    baseToken: { address: definition.token, name: definition.name, symbol: definition.symbol },
    quoteToken: { address: WETH, name: "Wrapped Ether", symbol: "WETH" },
    assetSide: "BASE",
    displayEligibility: "eligible",
    chartEligibility: definition.version === 4 ? "unavailable" : "eligible",
    executionEligibility: "view-only",
    provenance: "geckoterminal-pool-feed",
    priceUsd: definition.partial ? null : 0.00031 + index * 0.00007,
    liquidityUsd: definition.partial ? 18_000 : 48_000 + index * 17_500,
    marketCapUsd: definition.partial ? null : 310_000 + index * 95_000,
    fdvUsd: 410_000 + index * 110_000,
    volume24h: definition.partial ? null : 82_000 + index * 21_000,
    priceChange24h: definition.partial ? null : 1.4 + index * 0.7,
    pairCreatedAt: FIXTURE_EPOCH_MS - definition.ageMinutes * 60_000,
  };
  return {
    fixtureAuthority: "SYNTHETIC_RENDERING_DATA",
    executionFixture: definition.execution,
    heldFixture: definition.held === true,
    assetId,
    address: definition.token,
    name: definition.name,
    symbol: definition.symbol,
    pairAddress: definition.pair,
    url: `https://dexscreener.com/robinhood/${definition.pair}`,
    dexId: definition.dexId,
    project: null,
    socials: { x: null, telegram: null, discord: null, website: null, farcaster: null, provenance: "none" },
    origin: { kind: "external", state: "unknown", coverage: "unavailable" },
    venue: { kind: "dex", dexId: definition.dexId, pairAddress: definition.pair, url: null, execution: "read-only" },
    priceUsd: evidence.priceUsd,
    liquidityUsd: evidence.liquidityUsd,
    marketCapUsd: evidence.marketCapUsd,
    fdvUsd: evidence.fdvUsd,
    volume5m: definition.activity ? 1_800 + index * 100 : null,
    volume1h: definition.activity ? 11_000 + index * 1_000 : null,
    volume24h: evidence.volume24h,
    priceChange5m: definition.activity ? 0.8 : null,
    priceChange1h: definition.activity ? 1.2 : null,
    priceChange24h: evidence.priceChange24h,
    buys5m: definition.activity ? 12 + index : null,
    sells5m: definition.activity ? 5 + index : null,
    buys1h: definition.activity ? 42 + index : null,
    sells1h: definition.activity ? 21 + index : null,
    buys24h: definition.activity ? 310 + index : null,
    sells24h: definition.activity ? 180 + index : null,
    pairCreatedAt: evidence.pairCreatedAt,
    ageMinutes: definition.ageMinutes,
    momentumScore: definition.signal === "moving" ? 74 : null,
    buyPressureBps: definition.activity ? 6_300 : null,
    signal: definition.signal,
    riskFlags: [],
    primaryMarket: evidence,
    verifiedMarkets: [evidence],
    stockAssetRelationships: [],
  };
});

export const VISIBLE_TOKEN_MARKETS = [...TOKEN_MARKETS, ...BROAD_TOKEN_MARKETS];

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
