import {
  getAddress,
  keccak256,
  parseAbiItem,
  stringToHex,
  type AbiEvent,
  type Address,
  type Hex
} from "viem";

export const MARKET_INDEXER_CHAIN_ID = 4663 as const;
export const MARKET_INDEXER_SCHEMA_VERSION = 3 as const;
export const MARKET_INDEXER_MIGRATION_SCHEMA_VERSION = 3_001 as const;
export const MARKET_INDEXER_ACTIVATION_LOCKED = true as const;

export type MarketSourceKind =
  | "v2-factory"
  | "v3-factory"
  | "v4-manager"
  | "up-v2-factory"
  | "up-cl-factory";

export type RuntimeDependency = Readonly<{
  id: string;
  contract: Address;
  runtimeCodeHash: Hex;
  upstream: string;
  startBlock?: bigint;
  deploymentTransaction?: Hex;
}>;

export type DeploymentDependency = RuntimeDependency & Readonly<{
  startBlock: bigint;
  deploymentTransaction: Hex;
}>;

export type MarketSource = Readonly<{
  id: string;
  protocol: "sushiswap" | "uniswap" | "up";
  version: 2 | 3 | 4;
  kind: MarketSourceKind;
  contract: Address;
  startBlock: bigint;
  deploymentTransaction: Hex;
  runtimeCodeHash: Hex;
  upstream: string;
  event: AbiEvent;
}>;

export const pairCreatedEvent = parseAbiItem(
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256 pairIndex)"
);
export const poolCreatedEvent = parseAbiItem(
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)"
);
export const poolInitializedEvent = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)"
);
export const upV2PoolCreatedEvent = parseAbiItem(
  "event PoolCreated(address indexed token0, address indexed token1, bool indexed stable, address pool, uint256 poolIndex)"
);
export const upClPoolCreatedEvent = parseAbiItem(
  "event PoolCreated(address indexed token0, address indexed token1, int24 indexed tickSpacing, address pool)"
);

const blockscoutContract = (address: Address) =>
  `https://robinhoodchain.blockscout.com/address/${address}?tab=contract`;
const UP_OFFICIAL_DEPLOYMENT_RECORD =
  "https://up33.xyz/assets/index-Cx7kG_8N.js";

export const UP_VOTER: DeploymentDependency = Object.freeze({
  id: "up-voter",
  contract: getAddress("0x7F749fDD351C1Ceed82d76d7699CB631Eb8332a7"),
  startBlock: 6_181_013n,
  deploymentTransaction:
    "0x8e28c99241eb3c9754b2b6e2d3cb95687c42c0d6068f1015e1e6f3a4a61c7147",
  runtimeCodeHash:
    "0xd3805b025dfd7d910cb3658b759688ecc3d5e839d28fe43a763c4722ffe2a513",
  upstream: UP_OFFICIAL_DEPLOYMENT_RECORD
});

export const UP_V2_POOL_IMPLEMENTATION: RuntimeDependency = Object.freeze({
  id: "up-v2-pool-implementation",
  contract: getAddress("0xfc68447c9AAE40253f5b27887E0e36A5792E34ef"),
  runtimeCodeHash:
    "0xc6b3ca70ee1b4f15b6242f2ba31090e23c3d5f5b88d34bd52bc3c1d285219708",
  upstream: blockscoutContract(
    getAddress("0xfc68447c9AAE40253f5b27887E0e36A5792E34ef")
  )
});

export const UP_CL_POOL_IMPLEMENTATION: RuntimeDependency = Object.freeze({
  id: "up-cl-pool-implementation",
  contract: getAddress("0x11725976BF1F38c4aB78d1F480bc5883d70D9dc3"),
  runtimeCodeHash:
    "0xa2cf7f366f3d8d11e611acecf7916a27308ba041bf1e161bddbd4ecbb9402b6a",
  upstream: blockscoutContract(
    getAddress("0x11725976BF1F38c4aB78d1F480bc5883d70D9dc3")
  )
});

export const marketSources: readonly MarketSource[] = Object.freeze([
  {
    id: "sushiswap-v2",
    protocol: "sushiswap",
    version: 2,
    kind: "v2-factory",
    contract: getAddress("0xE52abd50ad151ecDf56427effD715E703696a6B1"),
    startBlock: 6_269_958n,
    deploymentTransaction:
      "0xe6f9be49a97ffe17cbbe2af9cf85f0f36d5d000666b7064facf16528d670a623",
    runtimeCodeHash:
      "0xeba2e349904f5b2c1f6086ffb00d5c7efb4a2c8ea8af2efccfd1c812c7869b6c",
    upstream:
      "https://github.com/sushi-labs/sushi/blob/c74a93dcbbcdd4ad9d4b86669880f182dcaeb680/src/evm/config/features/sushiswap-v2.ts",
    event: pairCreatedEvent
  },
  {
    id: "sushiswap-v3",
    protocol: "sushiswap",
    version: 3,
    kind: "v3-factory",
    contract: getAddress("0xE51960f1B45f1C9FB6D166E6a884F866fC70433B"),
    startBlock: 6_292_626n,
    deploymentTransaction:
      "0xe930991f25f4ccad299638819eef7e3d3888606752991013bad68bafee2343a0",
    runtimeCodeHash:
      "0x1d515a200d61f60a4075b5895f5f282b05e0772ca0749f9fa1589e981165d5f0",
    upstream:
      "https://github.com/sushi-labs/sushi/blob/c74a93dcbbcdd4ad9d4b86669880f182dcaeb680/src/evm/config/features/sushiswap-v3.ts",
    event: poolCreatedEvent
  },
  {
    id: "uniswap-v2",
    protocol: "uniswap",
    version: 2,
    kind: "v2-factory",
    contract: getAddress("0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f"),
    startBlock: 8_928n,
    deploymentTransaction:
      "0x2fc08b6c72d5f2120cec9f3be8ed0b45c210d51adbc87f33b2135886681edaf7",
    runtimeCodeHash:
      "0xbab145d02e7005f0d84c6c1639d39b799b0ea16df99ebbdaf5a14d9da820b4e0",
    upstream:
      "https://github.com/Uniswap/contracts/blob/37936185dee7decf681360ec799c124e0e034672/deployments/json/4663.json",
    event: pairCreatedEvent
  },
  {
    id: "uniswap-v3",
    protocol: "uniswap",
    version: 3,
    kind: "v3-factory",
    contract: getAddress("0x1f7d7550B1b028f7571e69A784071F0205FD2EfA"),
    startBlock: 8_930n,
    deploymentTransaction:
      "0x8add72fbcad4bf7732336de35dcd06b582c1501d0832c4710a30850a7cff8977",
    runtimeCodeHash:
      "0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739",
    upstream:
      "https://github.com/Uniswap/contracts/blob/37936185dee7decf681360ec799c124e0e034672/deployments/json/4663.json",
    event: poolCreatedEvent
  },
  {
    id: "uniswap-v4",
    protocol: "uniswap",
    version: 4,
    kind: "v4-manager",
    contract: getAddress("0x8366a39CC670B4001A1121B8F6A443A643E40951"),
    startBlock: 9_070n,
    deploymentTransaction:
      "0x4fb28d4935866f462582c6c931c6f2705e55f5be5eb178c7d8d9329a95c44c41",
    runtimeCodeHash:
      "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
    upstream:
      "https://github.com/Uniswap/contracts/blob/37936185dee7decf681360ec799c124e0e034672/deployments/json/4663.json",
    event: poolInitializedEvent
  },
  {
    id: "up-v2",
    protocol: "up",
    version: 2,
    kind: "up-v2-factory",
    contract: getAddress("0xFA5429AEBa338BEa2BFcc1b9a889862Ee395bc28"),
    startBlock: 6_180_950n,
    deploymentTransaction:
      "0x4f463dc72e553dff79db1d6d9fb5ebbc6b78133dd2dd88502eb3805dce2184e7",
    runtimeCodeHash:
      "0x7f75a8c0d40ae515facdb48ef7c9deea450868acb62bf3d4a17282e690a64e8d",
    upstream: UP_OFFICIAL_DEPLOYMENT_RECORD,
    event: upV2PoolCreatedEvent
  },
  {
    id: "up-cl",
    protocol: "up",
    version: 3,
    kind: "up-cl-factory",
    contract: getAddress("0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3"),
    startBlock: 6_184_096n,
    deploymentTransaction:
      "0x07f11d2097e6899af90bf7ea1e69e036ba4f052dbd715a2de9273ebee75ce4ed",
    runtimeCodeHash:
      "0x4350c8fcdf90361969542249d76c25d6afbd31f10bebf0134bfe21beba1e8f4c",
    upstream: UP_OFFICIAL_DEPLOYMENT_RECORD,
    event: upClPoolCreatedEvent
  }
]);

function sourceManifestMaterial(sources: readonly MarketSource[]) {
  return sources
  .map((source) =>
    [
      source.id,
      source.protocol,
      source.version,
      source.kind,
      source.contract.toLowerCase(),
      source.startBlock.toString(),
      source.deploymentTransaction,
      source.runtimeCodeHash,
      source.upstream
    ].join("|")
  )
  .join("\n");
}

function dependencyManifestMaterial() {
  return [UP_VOTER, UP_V2_POOL_IMPLEMENTATION, UP_CL_POOL_IMPLEMENTATION]
    .map((dependency) =>
      [
        dependency.id,
        dependency.contract.toLowerCase(),
        dependency.startBlock?.toString() ?? "runtime-only",
        dependency.deploymentTransaction ?? "runtime-only",
        dependency.runtimeCodeHash,
        dependency.upstream
      ].join("|")
    )
    .join("\n");
}

const legacySources = marketSources.slice(0, 5);

export const MARKET_SOURCE_MANIFEST_V1_HASH = keccak256(
  stringToHex(sourceManifestMaterial(legacySources))
);

export const MARKET_SOURCE_MANIFEST_HASH = keccak256(
  stringToHex(
    `${sourceManifestMaterial(marketSources)}\n${dependencyManifestMaterial()}`
  )
);
