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
import { ROBINHOOD_WETH_ADDRESS, isRobinhoodNativeAsset } from "./robinhood-assets";

export const RMT_UNISWAP_V3_V2_PROVIDER_ID = keccak256(stringToHex("RMT_UNISWAP_V3_ROUTER02_V2"));
export const RMT_UNISWAP_V3_V2_POLICY_ID_HASH = keccak256(stringToHex("RMT_EXECUTION_V2"));
const ROUTE_DOMAIN = keccak256(stringToHex("RMT_UNISWAP_V3_ROUTE_V2"));

export const rmtUniswapV3FeeExecutorV2Abi = [{
  type: "function", name: "execute", stateMutability: "payable",
  inputs: [{ name: "authorization", type: "tuple", components: [
    { name: "executionId", type: "bytes32" }, { name: "policyIdHash", type: "bytes32" },
    { name: "policyVersion", type: "uint256" }, { name: "policyHash", type: "bytes32" },
    { name: "feeBps", type: "uint16" }, { name: "feeSide", type: "uint8" },
    { name: "feeAsset", type: "address" }, { name: "treasury", type: "address" },
    { name: "trader", type: "address" }, { name: "requestedInputAsset", type: "address" },
    { name: "requestedOutputAsset", type: "address" }, { name: "routedInputAsset", type: "address" },
    { name: "routedOutputAsset", type: "address" }, { name: "userGrossInput", type: "uint256" },
    { name: "expectedFeeAtomic", type: "uint256" }, { name: "maximumFeeAtomic", type: "uint256" },
    { name: "providerInput", type: "uint256" }, { name: "expectedProviderOutput", type: "uint256" },
    { name: "protectedOutput", type: "uint256" }, { name: "deadline", type: "uint256" },
    { name: "routeIdentity", type: "bytes32" }
  ] }, { name: "route", type: "tuple", components: [
    { name: "kind", type: "uint8" }, { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" }, { name: "fee0", type: "uint24" },
    { name: "fee1", type: "uint24" }, { name: "pool0", type: "address" },
    { name: "pool1", type: "address" }
  ] }],
  outputs: [{ name: "actualProviderOutput", type: "uint256" }, { name: "actualRmtFee", type: "uint256" }]
}] as const;

export type RmtUniswapV3FeeRouteV2 = {
  kind: 0 | 1;
  tokenIn: Address;
  tokenOut: Address;
  fee0: number;
  fee1: number;
  pool0: Address;
  pool1: Address;
};

export type RmtUniswapV3FeeExecutionV2 = {
  executor: Address;
  executorRuntimeHash: Hex;
  executionId: Hex;
  policyIdHash: Hex;
  policyVersion: 2;
  policyHash: Hex;
  feeBps: 25;
  feeSide: "input";
  feeAsset: Address;
  treasury: Address;
  trader: Address;
  requestedInputAsset: Address;
  requestedOutputAsset: Address;
  routedInputAsset: Address;
  routedOutputAsset: Address;
  userGrossInputAtomic: string;
  expectedFeeAtomic: string;
  maximumFeeAtomic: string;
  providerInputAtomic: string;
  providerExpectedOutputAtomic: string;
  protectedOutputAtomic: string;
  deadline: string;
  routeIdentity: Hex;
  route: RmtUniswapV3FeeRouteV2;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`RMT rejected inconsistent Uniswap V3 V2 authority: ${message}.`);
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

export function rmtUniswapV3RouteIdentityV2(route: RmtUniswapV3FeeRouteV2) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32 domain, uint8 kind, address tokenIn, address tokenOut, uint24 fee0, uint24 fee1, address pool0, address pool1"),
    [ROUTE_DOMAIN, route.kind, route.tokenIn, route.tokenOut, route.fee0, route.fee1, route.pool0, route.pool1]
  ));
}

export function createRmtUniswapV3FeeExecutionV2(input: {
  executor: string;
  executorRuntimeHash: Hex;
  executionId: Hex;
  economics: RmtExecutionFeeV2Economics;
  trader: string;
  inputAsset: string;
  outputAsset: string;
  deadline: string;
  route: RmtUniswapV3FeeRouteV2;
}) {
  assertRmtExecutionFeeV2Economics(input.economics);
  const requestedInputAsset = exactAddress(input.inputAsset, "requested input");
  const requestedOutputAsset = exactAddress(input.outputAsset, "requested output");
  const route = {
    ...input.route,
    tokenIn: exactAddress(input.route.tokenIn, "routed input"),
    tokenOut: exactAddress(input.route.tokenOut, "routed output"),
    pool0: exactAddress(input.route.pool0, "first pool"),
    pool1: exactAddress(input.route.pool1, "second pool")
  };
  const execution: RmtUniswapV3FeeExecutionV2 = {
    executor: exactAddress(input.executor, "executor"),
    executorRuntimeHash: input.executorRuntimeHash,
    executionId: input.executionId,
    policyIdHash: RMT_UNISWAP_V3_V2_POLICY_ID_HASH,
    policyVersion: 2,
    policyHash: input.economics.policyHash,
    feeBps: 25,
    feeSide: "input",
    feeAsset: addressFromAssetId(input.economics.feeAsset),
    treasury: getAddress(input.economics.treasury),
    trader: exactAddress(input.trader, "trader"),
    requestedInputAsset,
    requestedOutputAsset,
    routedInputAsset: route.tokenIn,
    routedOutputAsset: route.tokenOut,
    userGrossInputAtomic: input.economics.userGrossInputAtomic,
    expectedFeeAtomic: input.economics.expectedFeeAtomic,
    maximumFeeAtomic: input.economics.maximumFeeAtomic,
    providerInputAtomic: input.economics.providerInputAtomic,
    providerExpectedOutputAtomic: input.economics.providerGrossExpectedOutputAtomic,
    protectedOutputAtomic: input.economics.providerProtectedOutputAtomic,
    deadline: atomic(input.deadline, "deadline").toString(),
    routeIdentity: rmtUniswapV3RouteIdentityV2(route),
    route
  };
  assertRmtUniswapV3FeeExecutionV2(execution, input.economics);
  return execution;
}

export function assertRmtUniswapV3FeeExecutionV2(
  execution: RmtUniswapV3FeeExecutionV2,
  economics: RmtExecutionFeeV2Economics
) {
  assertRmtExecutionFeeV2Economics(economics);
  invariant(/^0x[0-9a-fA-F]{64}$/.test(execution.executorRuntimeHash), "executor runtime hash is invalid");
  invariant(/^0x[0-9a-fA-F]{64}$/.test(execution.executionId) && execution.executionId !== `0x${"0".repeat(64)}`, "execution ID is invalid");
  invariant(execution.policyIdHash.toLowerCase() === RMT_UNISWAP_V3_V2_POLICY_ID_HASH.toLowerCase(), "policy ID changed");
  invariant(execution.policyVersion === 2 && execution.feeBps === 25 && execution.feeSide === "input", "policy constants changed");
  invariant(execution.policyHash.toLowerCase() === economics.policyHash.toLowerCase(), "policy hash changed");
  invariant(getAddress(execution.treasury) === getAddress(economics.treasury), "treasury changed");
  invariant(execution.userGrossInputAtomic === economics.userGrossInputAtomic, "gross input changed");
  invariant(execution.expectedFeeAtomic === economics.expectedFeeAtomic && execution.maximumFeeAtomic === economics.maximumFeeAtomic, "fee changed");
  invariant(execution.providerInputAtomic === economics.providerInputAtomic, "provider input changed");
  invariant(execution.providerExpectedOutputAtomic === economics.providerGrossExpectedOutputAtomic, "provider output changed");
  invariant(execution.protectedOutputAtomic === economics.providerProtectedOutputAtomic, "protected output changed");
  invariant(execution.feeAsset === addressFromAssetId(economics.feeAsset), "fee asset changed");
  invariant(execution.requestedInputAsset === addressFromAssetId(economics.inputAsset), "requested input changed");
  invariant(execution.requestedOutputAsset === addressFromAssetId(economics.outputAsset), "requested output changed");
  invariant(
    execution.routedInputAsset === (isRobinhoodNativeAsset(execution.requestedInputAsset) ? ROBINHOOD_WETH_ADDRESS : execution.requestedInputAsset),
    "routed input changed"
  );
  invariant(
    execution.routedOutputAsset === (isRobinhoodNativeAsset(execution.requestedOutputAsset) ? ROBINHOOD_WETH_ADDRESS : execution.requestedOutputAsset),
    "routed output changed"
  );
  invariant(execution.route.tokenIn === execution.routedInputAsset && execution.route.tokenOut === execution.routedOutputAsset, "route assets changed");
  invariant(execution.routeIdentity.toLowerCase() === rmtUniswapV3RouteIdentityV2(execution.route).toLowerCase(), "route identity changed");
  invariant([100, 500, 3_000, 10_000].includes(execution.route.fee0), "first fee tier is unsupported");
  if (execution.route.kind === 0) {
    invariant(execution.route.fee1 === 0 && execution.route.pool1 === zeroAddress, "direct route has a second leg");
  } else {
    invariant(
      execution.route.tokenIn !== ROBINHOOD_WETH_ADDRESS && execution.route.tokenOut !== ROBINHOOD_WETH_ADDRESS,
      "WETH hop is redundant"
    );
    invariant([100, 500, 3_000, 10_000].includes(execution.route.fee1) && execution.route.pool1 !== zeroAddress, "second route leg is invalid");
  }
  atomic(execution.expectedFeeAtomic, "expected fee", true);
  atomic(execution.maximumFeeAtomic, "maximum fee", true);
  atomic(execution.protectedOutputAtomic, "protected output");
  atomic(execution.deadline, "deadline");
  return true;
}

function authorizationTuple(execution: RmtUniswapV3FeeExecutionV2) {
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
    requestedInputAsset: execution.requestedInputAsset,
    requestedOutputAsset: execution.requestedOutputAsset,
    routedInputAsset: execution.routedInputAsset,
    routedOutputAsset: execution.routedOutputAsset,
    userGrossInput: BigInt(execution.userGrossInputAtomic),
    expectedFeeAtomic: BigInt(execution.expectedFeeAtomic),
    maximumFeeAtomic: BigInt(execution.maximumFeeAtomic),
    providerInput: BigInt(execution.providerInputAtomic),
    expectedProviderOutput: BigInt(execution.providerExpectedOutputAtomic),
    protectedOutput: BigInt(execution.protectedOutputAtomic),
    deadline: BigInt(execution.deadline),
    routeIdentity: execution.routeIdentity
  } as const;
}

export function encodeRmtUniswapV3FeeExecutionV2(execution: RmtUniswapV3FeeExecutionV2) {
  return encodeFunctionData({
    abi: rmtUniswapV3FeeExecutorV2Abi,
    functionName: "execute",
    args: [authorizationTuple(execution), execution.route]
  });
}

export function assertRmtUniswapV3FeeCalldataV2(
  data: Hex,
  expected: RmtUniswapV3FeeExecutionV2,
  economics: RmtExecutionFeeV2Economics
) {
  assertRmtUniswapV3FeeExecutionV2(expected, economics);
  const decoded = decodeFunctionData({ abi: rmtUniswapV3FeeExecutorV2Abi, data });
  invariant(decoded.functionName === "execute", "execution method changed");
  invariant(encodeRmtUniswapV3FeeExecutionV2(expected).toLowerCase() === data.toLowerCase(), "calldata changed");
  return true;
}
