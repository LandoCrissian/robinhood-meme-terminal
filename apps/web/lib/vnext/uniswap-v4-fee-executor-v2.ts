import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseAbiParameters,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import {
  assertRmtExecutionFeeV2Economics,
  type RmtExecutionFeeV2Economics
} from "./execution-fee-policy-v2";

export const RMT_UNISWAP_V4_V2_PROVIDER_ID = keccak256(stringToHex("RMT_UNISWAP_V4_POOL_MANAGER_V2"));
export const RMT_UNISWAP_V4_V2_POLICY_ID_HASH = keccak256(stringToHex("RMT_EXECUTION_V2"));
export const RMT_UNISWAP_V4_V2_EMPTY_HOOK_DATA_HASH = keccak256("0x");
export const RMT_UNISWAP_V4_V2_IMPLEMENTATION_ID = "rmt-uniswap-v4-fee-executor-v2";
const REQUEST_DOMAIN = keccak256(stringToHex("RMT_UNISWAP_V4_REQUEST_V2"));
const HASH = /^0x[0-9a-fA-F]{64}$/;

const poolKeyComponents = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" }
] as const;

const authorizationComponents = [
  { name: "executionId", type: "bytes32" }, { name: "policyIdHash", type: "bytes32" },
  { name: "policyVersion", type: "uint256" }, { name: "policyHash", type: "bytes32" },
  { name: "feeBps", type: "uint16" }, { name: "feeSide", type: "uint8" },
  { name: "feeAsset", type: "address" }, { name: "treasury", type: "address" },
  { name: "trader", type: "address" }, { name: "recipient", type: "address" },
  { name: "requestedInputAsset", type: "address" }, { name: "requestedOutputAsset", type: "address" },
  { name: "userGrossInput", type: "uint256" }, { name: "expectedFeeAtomic", type: "uint256" },
  { name: "maximumFeeAtomic", type: "uint256" }, { name: "providerInput", type: "uint256" },
  { name: "expectedProviderOutput", type: "uint256" }, { name: "protectedOutput", type: "uint256" },
  { name: "deadline", type: "uint256" }, { name: "poolId", type: "bytes32" },
  { name: "hookDataHash", type: "bytes32" }, { name: "requestIdentity", type: "bytes32" }
] as const;

export const rmtUniswapV4FeeExecutorV2Abi = [{
  type: "function", name: "execute", stateMutability: "payable",
  inputs: [
    { name: "authorization", type: "tuple", components: authorizationComponents },
    { name: "poolKey", type: "tuple", components: poolKeyComponents }
  ],
  outputs: [
    { name: "actualProviderOutput", type: "uint256" },
    { name: "actualRmtFee", type: "uint256" }
  ]
}, {
  type: "event", name: "RMTUniswapV4FeeSettledV2", anonymous: false,
  inputs: [
    { indexed: true, name: "executionId", type: "bytes32" },
    { indexed: true, name: "policyHash", type: "bytes32" },
    { indexed: true, name: "trader", type: "address" },
    { indexed: false, name: "policyIdHash", type: "bytes32" },
    { indexed: false, name: "policyVersion", type: "uint256" },
    { indexed: false, name: "providerId", type: "bytes32" },
    { indexed: false, name: "poolManager", type: "address" },
    { indexed: false, name: "poolId", type: "bytes32" },
    { indexed: false, name: "recipient", type: "address" },
    { indexed: false, name: "requestedInputAsset", type: "address" },
    { indexed: false, name: "requestedOutputAsset", type: "address" },
    { indexed: false, name: "feeAsset", type: "address" },
    { indexed: false, name: "feeBps", type: "uint16" },
    { indexed: false, name: "feeSide", type: "uint8" },
    { indexed: false, name: "userGrossInput", type: "uint256" },
    { indexed: false, name: "providerInput", type: "uint256" },
    { indexed: false, name: "actualProviderOutput", type: "uint256" },
    { indexed: false, name: "actualRmtFee", type: "uint256" },
    { indexed: false, name: "treasury", type: "address" }
  ]
}] as const;

export type RmtUniswapV4PoolKeyV2 = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type RmtUniswapV4FeeExecutionV2 = {
  executor: Address;
  executorRuntimeHash: Hex;
  poolManager: Address;
  poolManagerRuntimeHash: Hex;
  executionId: Hex;
  policyIdHash: Hex;
  policyVersion: 2;
  policyHash: Hex;
  feeBps: 25;
  feeSide: "input";
  feeAsset: Address;
  treasury: Address;
  trader: Address;
  recipient: Address;
  requestedInputAsset: Address;
  requestedOutputAsset: Address;
  userGrossInputAtomic: string;
  expectedFeeAtomic: string;
  maximumFeeAtomic: string;
  providerInputAtomic: string;
  providerExpectedOutputAtomic: string;
  protectedOutputAtomic: string;
  deadline: string;
  poolId: Hex;
  hookDataHash: Hex;
  requestIdentity: Hex;
  poolKey: RmtUniswapV4PoolKeyV2;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`RMT rejected inconsistent Uniswap V4 V2 authority: ${message}.`);
}

function exactAddress(value: string, label: string) {
  invariant(isAddress(value, { strict: false }), `${label} is invalid`);
  return getAddress(value);
}

function atomic(value: string, label: string, allowZero = false) {
  invariant(/^(0|[1-9][0-9]*)$/.test(value), `${label} is not canonical`);
  const amount = BigInt(value);
  invariant(allowZero || amount > 0n, `${label} must be positive`);
  return amount;
}

function addressFromAssetId(assetId: string) {
  return assetId.endsWith("/native")
    ? zeroAddress
    : exactAddress(assetId.slice(assetId.lastIndexOf(":") + 1), "economics asset");
}

export function rmtUniswapV4PoolIdV2(poolKey: RmtUniswapV4PoolKeyV2) {
  return keccak256(encodeAbiParameters(
    [{ type: "tuple", components: poolKeyComponents }],
    [poolKey]
  ));
}

function requestIdentity(execution: Omit<RmtUniswapV4FeeExecutionV2, "requestIdentity">) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32 domain, bytes32 executionId, bytes32 policyIdHash, uint256 policyVersion, bytes32 policyHash, uint16 feeBps, uint8 feeSide, address feeAsset, address treasury, address trader, address recipient, address requestedInputAsset, address requestedOutputAsset, uint256 userGrossInput, uint256 expectedFeeAtomic, uint256 maximumFeeAtomic, uint256 providerInput, uint256 expectedProviderOutput, uint256 protectedOutput, uint256 deadline, bytes32 poolId, bytes32 hookDataHash, address currency0, address currency1, uint24 poolFee, int24 tickSpacing, address hooks"),
    [
      REQUEST_DOMAIN,
      execution.executionId,
      execution.policyIdHash,
      BigInt(execution.policyVersion),
      execution.policyHash,
      execution.feeBps,
      0,
      execution.feeAsset,
      execution.treasury,
      execution.trader,
      execution.recipient,
      execution.requestedInputAsset,
      execution.requestedOutputAsset,
      BigInt(execution.userGrossInputAtomic),
      BigInt(execution.expectedFeeAtomic),
      BigInt(execution.maximumFeeAtomic),
      BigInt(execution.providerInputAtomic),
      BigInt(execution.providerExpectedOutputAtomic),
      BigInt(execution.protectedOutputAtomic),
      BigInt(execution.deadline),
      execution.poolId,
      execution.hookDataHash,
      execution.poolKey.currency0,
      execution.poolKey.currency1,
      execution.poolKey.fee,
      execution.poolKey.tickSpacing,
      execution.poolKey.hooks
    ]
  ));
}

export function createRmtUniswapV4FeeExecutionV2(input: {
  executor: string;
  executorRuntimeHash: Hex;
  poolManager: string;
  poolManagerRuntimeHash: Hex;
  executionId: Hex;
  economics: RmtExecutionFeeV2Economics;
  trader: string;
  recipient: string;
  inputAsset: string;
  outputAsset: string;
  deadline: string;
  poolKey: RmtUniswapV4PoolKeyV2;
}) {
  assertRmtExecutionFeeV2Economics(input.economics);
  const poolKey = {
    currency0: exactAddress(input.poolKey.currency0, "currency0"),
    currency1: exactAddress(input.poolKey.currency1, "currency1"),
    fee: input.poolKey.fee,
    tickSpacing: input.poolKey.tickSpacing,
    hooks: exactAddress(input.poolKey.hooks, "hooks")
  };
  const base: Omit<RmtUniswapV4FeeExecutionV2, "requestIdentity"> = {
    executor: exactAddress(input.executor, "executor"),
    executorRuntimeHash: input.executorRuntimeHash,
    poolManager: exactAddress(input.poolManager, "PoolManager"),
    poolManagerRuntimeHash: input.poolManagerRuntimeHash,
    executionId: input.executionId,
    policyIdHash: RMT_UNISWAP_V4_V2_POLICY_ID_HASH,
    policyVersion: 2,
    policyHash: input.economics.policyHash,
    feeBps: 25,
    feeSide: "input",
    feeAsset: addressFromAssetId(input.economics.feeAsset),
    treasury: getAddress(input.economics.treasury),
    trader: exactAddress(input.trader, "trader"),
    recipient: exactAddress(input.recipient, "recipient"),
    requestedInputAsset: exactAddress(input.inputAsset, "requested input"),
    requestedOutputAsset: exactAddress(input.outputAsset, "requested output"),
    userGrossInputAtomic: input.economics.userGrossInputAtomic,
    expectedFeeAtomic: input.economics.expectedFeeAtomic,
    maximumFeeAtomic: input.economics.maximumFeeAtomic,
    providerInputAtomic: input.economics.providerInputAtomic,
    providerExpectedOutputAtomic: input.economics.providerGrossExpectedOutputAtomic,
    protectedOutputAtomic: input.economics.providerProtectedOutputAtomic,
    deadline: atomic(input.deadline, "deadline").toString(),
    poolId: rmtUniswapV4PoolIdV2(poolKey),
    hookDataHash: RMT_UNISWAP_V4_V2_EMPTY_HOOK_DATA_HASH,
    poolKey
  };
  const execution: RmtUniswapV4FeeExecutionV2 = { ...base, requestIdentity: requestIdentity(base) };
  assertRmtUniswapV4FeeExecutionV2(execution, input.economics);
  return execution;
}

export function assertRmtUniswapV4FeeExecutionV2(
  execution: RmtUniswapV4FeeExecutionV2,
  economics: RmtExecutionFeeV2Economics
) {
  assertRmtExecutionFeeV2Economics(economics);
  invariant(HASH.test(execution.executorRuntimeHash), "executor runtime hash is invalid");
  invariant(HASH.test(execution.poolManagerRuntimeHash), "PoolManager runtime hash is invalid");
  invariant(HASH.test(execution.executionId) && execution.executionId !== `0x${"0".repeat(64)}`, "execution ID is invalid");
  invariant(execution.policyIdHash.toLowerCase() === RMT_UNISWAP_V4_V2_POLICY_ID_HASH.toLowerCase(), "policy ID changed");
  invariant(execution.policyVersion === 2 && execution.feeBps === 25 && execution.feeSide === "input", "policy constants changed");
  invariant(execution.policyHash.toLowerCase() === economics.policyHash.toLowerCase(), "policy hash changed");
  invariant(execution.treasury === getAddress(economics.treasury), "treasury changed");
  invariant(execution.userGrossInputAtomic === economics.userGrossInputAtomic, "gross input changed");
  invariant(execution.expectedFeeAtomic === economics.expectedFeeAtomic && execution.maximumFeeAtomic === economics.maximumFeeAtomic, "fee changed");
  invariant(execution.providerInputAtomic === economics.providerInputAtomic, "provider input changed");
  invariant(execution.providerExpectedOutputAtomic === economics.providerGrossExpectedOutputAtomic, "provider output changed");
  invariant(execution.protectedOutputAtomic === economics.providerProtectedOutputAtomic, "protected output changed");
  invariant(execution.feeAsset === addressFromAssetId(economics.feeAsset), "fee asset changed");
  invariant(execution.requestedInputAsset === addressFromAssetId(economics.inputAsset), "requested input changed");
  invariant(execution.requestedOutputAsset === addressFromAssetId(economics.outputAsset), "requested output changed");
  invariant(execution.requestedInputAsset !== execution.requestedOutputAsset, "trade assets are equal");
  invariant(BigInt(execution.poolKey.currency0) < BigInt(execution.poolKey.currency1), "PoolKey currency order changed");
  invariant(
    [execution.poolKey.currency0, execution.poolKey.currency1].includes(execution.requestedInputAsset)
      && [execution.poolKey.currency0, execution.poolKey.currency1].includes(execution.requestedOutputAsset),
    "trade assets do not match the PoolKey"
  );
  invariant(execution.poolId.toLowerCase() === rmtUniswapV4PoolIdV2(execution.poolKey).toLowerCase(), "PoolId changed");
  invariant(execution.hookDataHash.toLowerCase() === RMT_UNISWAP_V4_V2_EMPTY_HOOK_DATA_HASH.toLowerCase(), "hook data is unsupported");
  const { requestIdentity: ignored, ...base } = execution;
  ignored;
  invariant(execution.requestIdentity.toLowerCase() === requestIdentity(base).toLowerCase(), "request identity changed");
  atomic(execution.expectedFeeAtomic, "expected fee", true);
  atomic(execution.maximumFeeAtomic, "maximum fee", true);
  atomic(execution.protectedOutputAtomic, "protected output");
  atomic(execution.deadline, "deadline");
  return true;
}

function authorizationTuple(execution: RmtUniswapV4FeeExecutionV2) {
  return {
    executionId: execution.executionId,
    policyIdHash: execution.policyIdHash,
    policyVersion: 2n,
    policyHash: execution.policyHash,
    feeBps: 25,
    feeSide: 0,
    feeAsset: execution.feeAsset,
    treasury: execution.treasury,
    trader: execution.trader,
    recipient: execution.recipient,
    requestedInputAsset: execution.requestedInputAsset,
    requestedOutputAsset: execution.requestedOutputAsset,
    userGrossInput: BigInt(execution.userGrossInputAtomic),
    expectedFeeAtomic: BigInt(execution.expectedFeeAtomic),
    maximumFeeAtomic: BigInt(execution.maximumFeeAtomic),
    providerInput: BigInt(execution.providerInputAtomic),
    expectedProviderOutput: BigInt(execution.providerExpectedOutputAtomic),
    protectedOutput: BigInt(execution.protectedOutputAtomic),
    deadline: BigInt(execution.deadline),
    poolId: execution.poolId,
    hookDataHash: execution.hookDataHash,
    requestIdentity: execution.requestIdentity
  } as const;
}

export function encodeRmtUniswapV4FeeExecutionV2(execution: RmtUniswapV4FeeExecutionV2) {
  return encodeFunctionData({
    abi: rmtUniswapV4FeeExecutorV2Abi,
    functionName: "execute",
    args: [authorizationTuple(execution), execution.poolKey]
  });
}

export function decodeRmtUniswapV4FeeAuthorizationV2(data: Hex) {
  const decoded = decodeFunctionData({ abi: rmtUniswapV4FeeExecutorV2Abi, data });
  invariant(decoded.functionName === "execute", "execution method changed");
  return decoded.args;
}

export function assertRmtUniswapV4FeeCalldataV2(
  data: Hex,
  expected: RmtUniswapV4FeeExecutionV2,
  economics: RmtExecutionFeeV2Economics
) {
  assertRmtUniswapV4FeeExecutionV2(expected, economics);
  invariant(encodeRmtUniswapV4FeeExecutionV2(expected).toLowerCase() === data.toLowerCase(), "calldata changed");
  return true;
}
