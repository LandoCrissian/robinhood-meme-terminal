import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseAbiParameters,
  toHex,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import type { VNextUniversalMarketSearchPool } from "./universal-market-search-contract";

export const RMT_CURATED_MARKET_CHAIN_ID = 4_663 as const;

export type RmtCuratedMarketEntry = {
  chainId: typeof RMT_CURATED_MARKET_CHAIN_ID;
  token: Address;
  aliases: readonly string[];
  enabled: true;
  market: VNextUniversalMarketSearchPool;
};

const NULL_STATE = {
  gaugeAddress: null,
  gaugeAlive: null,
  gaugeWeight: null,
  gaugeClaimable: null,
  feesAddress: null,
  bribeAddress: null
} as const;

function addressMarket(input: {
  token: Address;
  aliases: readonly string[];
  sourceId: "uniswap-v2" | "uniswap-v3";
  version: 2 | 3;
  pool: Address;
  token0: Address;
  token1: Address;
  fee?: number;
  tickSpacing?: number;
  transactionHash: Hex;
  blockNumber: string;
  blockHash: Hex;
}): RmtCuratedMarketEntry {
  return {
    chainId: RMT_CURATED_MARKET_CHAIN_ID,
    token: getAddress(input.token),
    aliases: Object.freeze([...input.aliases]),
    enabled: true,
    market: {
      sourceId: input.sourceId,
      protocol: "uniswap",
      version: input.version,
      poolKey: input.pool.toLowerCase(),
      poolAddress: input.pool.toLowerCase(),
      token0: input.token0.toLowerCase(),
      token1: input.token1.toLowerCase(),
      stable: null,
      fee: input.version === 3 ? input.fee! : null,
      tickSpacing: input.version === 3 ? input.tickSpacing! : null,
      hooks: null,
      transactionHash: input.transactionHash.toLowerCase(),
      blockNumber: input.blockNumber,
      blockHash: input.blockHash.toLowerCase(),
      stateStatus: null,
      liveFee: null,
      feeDenominator: null,
      ...NULL_STATE,
      stateObservedBlock: null,
      stateObservedBlockHash: null
    }
  };
}

function v4Market(input: {
  token: Address;
  aliases: readonly string[];
  poolId: Hex;
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
  transactionHash: Hex;
  blockNumber: string;
  blockHash: Hex;
}): RmtCuratedMarketEntry {
  const derivedPoolId = keccak256(encodeAbiParameters(
    parseAbiParameters("(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"),
    [{
      currency0: getAddress(input.currency0),
      currency1: getAddress(input.currency1),
      fee: input.fee,
      tickSpacing: input.tickSpacing,
      hooks: getAddress(input.hooks)
    }]
  ));
  if (derivedPoolId.toLowerCase() !== input.poolId.toLowerCase()) {
    throw new Error("A curated Uniswap V4 PoolKey does not derive its configured PoolId.");
  }
  return {
    chainId: RMT_CURATED_MARKET_CHAIN_ID,
    token: getAddress(input.token),
    aliases: Object.freeze([...input.aliases]),
    enabled: true,
    market: {
      sourceId: "uniswap-v4",
      protocol: "uniswap",
      version: 4,
      poolKey: input.poolId.toLowerCase(),
      poolAddress: null,
      token0: input.currency0.toLowerCase(),
      token1: input.currency1.toLowerCase(),
      stable: null,
      fee: input.fee,
      tickSpacing: input.tickSpacing,
      hooks: input.hooks.toLowerCase(),
      transactionHash: input.transactionHash.toLowerCase(),
      blockNumber: input.blockNumber,
      blockHash: input.blockHash.toLowerCase(),
      stateStatus: null,
      liveFee: null,
      feeDenominator: null,
      ...NULL_STATE,
      stateObservedBlock: null,
      stateObservedBlockHash: null
    }
  };
}

const WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const UNISWAP_V3_FACTORY = getAddress("0x1f7d7550B1b028f7571E69A784071F0205FD2EfA");
const UNISWAP_V2_FACTORY = getAddress("0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f");

export const RMT_CURATED_UNISWAP_FACTORIES = Object.freeze({
  v2: UNISWAP_V2_FACTORY,
  v3: UNISWAP_V3_FACTORY
});

const entries = [
  v4Market({
    token: getAddress("0xe934e36a439c94017b64a3fece66af12099abf50"),
    aliases: ["STONKBROKER", "$STONKBROKER", "StonkBroker", "Stonk Broker", "Stonk-Broker", "Stonk_Broker", "StonkBrokers"],
    poolId: "0xd33c8fd38b06e989cdbd4dffdefab71c4bdd415b24964c8d69e38ff35b068f92",
    currency0: zeroAddress,
    currency1: getAddress("0xe934e36a439c94017b64a3fece66af12099abf50"),
    fee: 10_000,
    tickSpacing: 200,
    hooks: zeroAddress,
    transactionHash: "0xd5c74c05e885ec3feed94ccbbc465ab91d687d7660692297011e49676f50e719",
    blockNumber: "12670814",
    blockHash: "0x8105c0eb7bcb8790e8ceee10dc56676148b648a7d6270463e04755429190bab9"
  }),
  addressMarket({
    token: getAddress("0x39dbed3a2bd333467115de45665cc57f813c4571"), aliases: ["PONS", "$PONS", "Pons"],
    sourceId: "uniswap-v3", version: 3, pool: getAddress("0x10CC6BD38112cAc182db90B6a71d8Bb5939526bA"),
    token0: WETH, token1: getAddress("0x39dbed3a2bd333467115de45665cc57f813c4571"), fee: 10_000, tickSpacing: 200,
    transactionHash: "0x1f54f25fec2d963dcb338ecb8b46a6eb123198a5c7a746d34cb2dbe78d074af8", blockNumber: "8963150", blockHash: "0xd18718d02fe1da449333e477bc588a41e59b1fd169a2b945a14fb17339d684a3"
  }),
  addressMarket({
    token: getAddress("0x5cb6f181081301b44905f3ae15419112ecabd8a6"), aliases: ["PIPEDOG", "$PIPEDOG", "pipedog", "Pipe Dog"],
    sourceId: "uniswap-v3", version: 3, pool: getAddress("0xB7f10f74B39291b9290b779978e19A7637C742D6"),
    token0: WETH, token1: getAddress("0x5cb6f181081301b44905f3ae15419112ecabd8a6"), fee: 10_000, tickSpacing: 200,
    transactionHash: "0x0abd4002d4a56e982ca813b486ceb16a0b5b97b49c95c1e58a78e6b29d83cab8", blockNumber: "21881211", blockHash: "0xab2e50c0111dc7c4461ff7cda76a924e29f32b9df19b27147b34463c6fab9118"
  }),
  addressMarket({
    token: getAddress("0x020bfc650a365f8bb26819deaabf3e21291018b4"), aliases: ["CASHCAT", "$CASHCAT", "Cash Cat"],
    sourceId: "uniswap-v3", version: 3, pool: getAddress("0xA70fc67C9F69da90B63a0e4C05D229954574E313"),
    token0: getAddress("0x020bfc650a365f8bb26819deaabf3e21291018b4"), token1: WETH, fee: 10_000, tickSpacing: 200,
    transactionHash: "0x0e6d23f0babd02ede4aefaa923486591d783e1180c277c71e2f2a39fc74a4661", blockNumber: "88836", blockHash: "0x5f7080d69cf24611a084a9c10196eabc148779ad8dd43a2a983aefdd17ab3fc6"
  }),
  addressMarket({
    token: getAddress("0xf0e17e54239cd945cd7bea471a3a2ca6a8c7f7a3"), aliases: ["LEMON.FUN", "LEMON", "$LEMON", "Lemon"],
    sourceId: "uniswap-v3", version: 3, pool: getAddress("0x01fe057d1C5FB09A4ac02860758DDf26Df9336B5"),
    token0: WETH, token1: getAddress("0xf0e17e54239cd945cd7bea471a3a2ca6a8c7f7a3"), fee: 10_000, tickSpacing: 200,
    transactionHash: "0x48a82224ef11e3b49902c03f962bb64a74fd828b843774a18883c31e0759104d", blockNumber: "19020802", blockHash: "0xe265c314d348c67a572b14dd91c570745363f4ca2493ff309128a7ce9315d0fd"
  }),
  addressMarket({
    token: getAddress("0xf0821f2bf570ca4e7499a9ed9db7c788fed9946f"), aliases: ["PEEP", "$PEEP"],
    sourceId: "uniswap-v2", version: 2, pool: getAddress("0xe70dd15481ba143f145fbe23e8916236d554d3c7"),
    token0: WETH, token1: getAddress("0xf0821f2bf570ca4e7499a9ed9db7c788fed9946f"),
    transactionHash: "0xf7a26164fd139670f67ca05eef8cb7bc9bf07fd073c9385a2ba8cd5a52a4fe38", blockNumber: "9711277", blockHash: "0x5c884a41f8073cc5df3c915ec610e7f77fbb7889870d52f46f8ab6956201ab32"
  }),
  v4Market({
    token: getAddress("0xb6ce51925c2e397ebf1a443b343d19267b3d4225"), aliases: ["HOPIUM", "$HOPIUM", "Hopium", "Hopium Machines"],
    poolId: "0xc1dbd75280b6d117b4ac1e27fcd00c6dccb1a2b2fbfa9923a2c492711299d337",
    currency0: zeroAddress, currency1: getAddress("0xb6ce51925c2e397ebf1a443b343d19267b3d4225"), fee: 0, tickSpacing: 200,
    hooks: getAddress("0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044"),
    transactionHash: "0x82b7d0771002e7b6ed257445dd4f34f051408165ed8e64762c8980af397611ef", blockNumber: "46294063", blockHash: "0xaf1b3a61caf6515d5ad7f7a48a97d8ec0d0f0a3cd1224cebc214f990708a0578"
  }),
  v4Market({
    token: getAddress("0x1139d423c1706bdead91f03507f521635591ed92"), aliases: ["CANNACAT", "$CANNACAT", "CannaCat", "Canna Cat"],
    poolId: "0x5f5ec0e1016bae2f04c122bbcd2c141a4177cc681d7c2e4463a1d172ed8430b3",
    currency0: zeroAddress, currency1: getAddress("0x1139d423c1706bdead91f03507f521635591ed92"), fee: 0, tickSpacing: 200,
    hooks: getAddress("0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044"),
    transactionHash: "0x239660e071411e86da99eaad2f5bbe1427b40fae6868ce21475ef34f009994a9", blockNumber: "44544646", blockHash: "0x10582df74469058a95c64ea407d853cd640cf2d9365d12154e3f57da9f995788"
  })
] as const;

export const RMT_CURATED_MARKET_REGISTRY: readonly RmtCuratedMarketEntry[] = Object.freeze(
  entries.map((entry) => Object.freeze({ ...entry, market: Object.freeze({ ...entry.market }) }))
);

export const RMT_CURATED_MARKET_MANIFEST_HASH = keccak256(toHex(JSON.stringify(
  RMT_CURATED_MARKET_REGISTRY.map((entry) => ({
    chainId: entry.chainId,
    token: entry.token.toLowerCase(),
    aliases: entry.aliases,
    enabled: entry.enabled,
    market: entry.market
  }))
)));

const byToken = new Map(RMT_CURATED_MARKET_REGISTRY.map((entry) => [entry.token.toLowerCase(), entry]));
const byPool = new Map(RMT_CURATED_MARKET_REGISTRY.map((entry) => [entry.market.poolKey.toLowerCase(), entry]));

export function rmtCuratedMarketByToken(address: string) {
  return byToken.get(address.toLowerCase()) ?? null;
}

export function rmtCuratedMarketByPool(pool: string) {
  return byPool.get(pool.toLowerCase()) ?? null;
}

export function isRmtCuratedMarketIdentity(value: string) {
  const normalized = value.toLowerCase();
  return byToken.has(normalized) || byPool.has(normalized);
}

export function normalizeRmtCuratedSearch(value: string) {
  const withoutDollar = value.trim().replace(/^\$/, "");
  return withoutDollar.toLowerCase().replace(/[\s_-]+/g, "");
}

export function rmtCuratedMarketSearchCandidates(query: string) {
  const normalized = normalizeRmtCuratedSearch(query);
  if (!normalized) return [];
  return RMT_CURATED_MARKET_REGISTRY.filter((entry) => entry.aliases.some((alias) => {
    const candidate = normalizeRmtCuratedSearch(alias);
    return normalized === candidate
      || (normalized.endsWith("s") ? normalized.slice(0, -1) : normalized)
        === (candidate.endsWith("s") ? candidate.slice(0, -1) : candidate);
  }));
}
