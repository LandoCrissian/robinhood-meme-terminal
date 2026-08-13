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
  assertRmtNetExecutionEconomics,
  type PlannedRmtFeeCommitment,
  type RmtNetExecutionEconomics
} from "./execution-fee-policy";
import { ROBINHOOD_WETH_ADDRESS } from "./robinhood-assets";

export const RMT_UNISWAP_V3_PROVIDER_ID = keccak256(stringToHex("RMT_UNISWAP_V3_ROUTER02_V1"));
const ROUTE_DOMAIN = keccak256(stringToHex("RMT_UNISWAP_V3_ROUTE_V1"));

export const rmtUniswapV3FeeExecutorAbi = [{
  type: "function", name: "executeInputFee", stateMutability: "payable",
  inputs: [{ name: "authorization", type: "tuple", components: [
    { name: "executionId", type: "bytes32" }, { name: "policyIdHash", type: "bytes32" },
    { name: "policyVersion", type: "uint256" }, { name: "policyHash", type: "bytes32" },
    { name: "feeBps", type: "uint16" }, { name: "feeSide", type: "uint8" },
    { name: "feeAsset", type: "address" }, { name: "expectedFeeAtomic", type: "uint256" },
    { name: "maximumFeeAtomic", type: "uint256" }, { name: "trader", type: "address" },
    { name: "userGrossInput", type: "uint256" }, { name: "providerInput", type: "uint256" },
    { name: "expectedGrossOutput", type: "uint256" }, { name: "routerMinimumGrossOutput", type: "uint256" },
    { name: "protectedUserNetOutput", type: "uint256" }, { name: "deadline", type: "uint256" },
    { name: "routeIdentity", type: "bytes32" }
  ] }, { name: "route", type: "tuple", components: [
    { name: "kind", type: "uint8" }, { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" }, { name: "fee0", type: "uint24" },
    { name: "fee1", type: "uint24" }, { name: "pool0", type: "address" },
    { name: "pool1", type: "address" }
  ] }],
  outputs: [
    { name: "grossActualOutput", type: "uint256" }, { name: "actualRmtFee", type: "uint256" },
    { name: "actualUserNetOutput", type: "uint256" }
  ]
}, {
  type: "function", name: "executeOutputFee", stateMutability: "payable",
  inputs: [{ name: "authorization", type: "tuple", components: [
    { name: "executionId", type: "bytes32" }, { name: "policyIdHash", type: "bytes32" },
    { name: "policyVersion", type: "uint256" }, { name: "policyHash", type: "bytes32" },
    { name: "feeBps", type: "uint16" }, { name: "feeSide", type: "uint8" },
    { name: "feeAsset", type: "address" }, { name: "expectedFeeAtomic", type: "uint256" },
    { name: "maximumFeeAtomic", type: "uint256" }, { name: "trader", type: "address" },
    { name: "userGrossInput", type: "uint256" }, { name: "providerInput", type: "uint256" },
    { name: "expectedGrossOutput", type: "uint256" }, { name: "routerMinimumGrossOutput", type: "uint256" },
    { name: "protectedUserNetOutput", type: "uint256" }, { name: "deadline", type: "uint256" },
    { name: "routeIdentity", type: "bytes32" }
  ] }, { name: "route", type: "tuple", components: [
    { name: "kind", type: "uint8" }, { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" }, { name: "fee0", type: "uint24" },
    { name: "fee1", type: "uint24" }, { name: "pool0", type: "address" },
    { name: "pool1", type: "address" }
  ] }],
  outputs: [
    { name: "grossActualOutput", type: "uint256" }, { name: "actualRmtFee", type: "uint256" },
    { name: "actualUserNetOutput", type: "uint256" }
  ]
}, {
  type: "event", name: "RMTUniswapV3FeeSettled", anonymous: false,
  inputs: [
    { indexed: true, name: "executionId", type: "bytes32" },
    { indexed: true, name: "policyHash", type: "bytes32" },
    { indexed: true, name: "trader", type: "address" },
    { indexed: false, name: "policyIdHash", type: "bytes32" },
    { indexed: false, name: "policyVersion", type: "uint256" },
    { indexed: false, name: "providerId", type: "bytes32" },
    { indexed: false, name: "router", type: "address" },
    { indexed: false, name: "routeIdentity", type: "bytes32" },
    { indexed: false, name: "feeAsset", type: "address" },
    { indexed: false, name: "feeBps", type: "uint16" },
    { indexed: false, name: "feeSide", type: "uint8" },
    { indexed: false, name: "userGrossInput", type: "uint256" },
    { indexed: false, name: "providerInput", type: "uint256" },
    { indexed: false, name: "grossActualOutput", type: "uint256" },
    { indexed: false, name: "actualRmtFee", type: "uint256" },
    { indexed: false, name: "actualUserNetOutput", type: "uint256" },
    { indexed: false, name: "treasury", type: "address" }
  ]
}] as const;

export type RmtUniswapV3FeeRoute = {
  kind: 0 | 1;
  tokenIn: Address;
  tokenOut: Address;
  fee0: number;
  fee1: number;
  pool0: Address;
  pool1: Address;
};

export type RmtUniswapV3FeeExecution = {
  executor: Address;
  executorRuntimeHash: Hex;
  executionId: Hex;
  policyId: string;
  policyIdHash: Hex;
  policyVersion: number;
  policyHash: Hex;
  treasury: Address;
  feeBps: number;
  feeSide: "input" | "output";
  feeAsset: Address;
  expectedFeeAtomic: string;
  maximumFeeAtomic: string;
  trader: Address;
  userGrossInputAtomic: string;
  providerInputAtomic: string;
  providerGrossExpectedOutputAtomic: string;
  routerMinimumGrossOutputAtomic: string;
  protectedUserNetOutputAtomic: string;
  deadline: string;
  routeIdentity: Hex;
  route: RmtUniswapV3FeeRoute;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`RMT rejected inconsistent fee-executor authority: ${message}.`);
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

export function rmtUniswapV3PolicyIdHash(policyId: string) {
  return keccak256(stringToHex(policyId));
}

export function rmtUniswapV3RouteIdentity(route: RmtUniswapV3FeeRoute) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32 domain, uint8 kind, address tokenIn, address tokenOut, uint24 fee0, uint24 fee1, address pool0, address pool1"),
    [ROUTE_DOMAIN, route.kind, route.tokenIn, route.tokenOut, route.fee0, route.fee1, route.pool0, route.pool1]
  ));
}

export function createRmtUniswapV3FeeExecution(input: {
  executor: string;
  executorRuntimeHash: Hex;
  executionId: Hex;
  policyId: string;
  netEconomics: RmtNetExecutionEconomics;
  trader: string;
  deadline: string;
  routerMinimumGrossOutputAtomic: string;
  route: RmtUniswapV3FeeRoute;
}) {
  assertRmtNetExecutionEconomics(input.netEconomics);
  invariant(input.netEconomics.rmtFee.state === "planned", "fee commitment is not active");
  const commitment = input.netEconomics.rmtFee as PlannedRmtFeeCommitment;
  const route = {
    ...input.route,
    tokenIn: exactAddress(input.route.tokenIn, "route input"),
    tokenOut: exactAddress(input.route.tokenOut, "route output"),
    pool0: exactAddress(input.route.pool0, "first pool"),
    pool1: exactAddress(input.route.pool1, "second pool")
  };
  const routeIdentity = rmtUniswapV3RouteIdentity(route);
  const execution: RmtUniswapV3FeeExecution = {
    executor: exactAddress(input.executor, "executor"),
    executorRuntimeHash: input.executorRuntimeHash,
    executionId: input.executionId,
    policyId: input.policyId,
    policyIdHash: rmtUniswapV3PolicyIdHash(input.policyId),
    policyVersion: commitment.feePolicyVersion,
    policyHash: commitment.feePolicyHash,
    treasury: getAddress(commitment.treasury),
    feeBps: commitment.feeBps,
    feeSide: commitment.feeSide,
    feeAsset: commitment.feeAssetId.endsWith("/native")
      ? zeroAddress
      : getAddress(commitment.feeAssetId.slice(commitment.feeAssetId.lastIndexOf(":") + 1)),
    expectedFeeAtomic: commitment.expectedFeeAtomic,
    maximumFeeAtomic: commitment.maximumFeeAtomic,
    trader: exactAddress(input.trader, "trader"),
    userGrossInputAtomic: input.netEconomics.userGrossInputAtomic,
    providerInputAtomic: input.netEconomics.providerInputAtomic,
    providerGrossExpectedOutputAtomic: input.netEconomics.providerGrossExpectedOutputAtomic,
    routerMinimumGrossOutputAtomic: atomic(input.routerMinimumGrossOutputAtomic, "router minimum").toString(),
    protectedUserNetOutputAtomic: input.netEconomics.protectedUserNetOutputAtomic,
    deadline: atomic(input.deadline, "deadline").toString(),
    routeIdentity,
    route
  };
  assertRmtUniswapV3FeeExecution(execution, input.netEconomics);
  return execution;
}

export function assertRmtUniswapV3FeeExecution(
  execution: RmtUniswapV3FeeExecution,
  economics: RmtNetExecutionEconomics
) {
  assertRmtNetExecutionEconomics(economics);
  invariant(economics.rmtFee.state === "planned", "fee economics are disabled");
  const commitment = economics.rmtFee as PlannedRmtFeeCommitment;
  invariant(/^0x[0-9a-fA-F]{64}$/.test(execution.executorRuntimeHash), "executor runtime hash is invalid");
  invariant(/^0x[0-9a-fA-F]{64}$/.test(execution.executionId) && execution.executionId !== `0x${"0".repeat(64)}`, "execution ID is invalid");
  invariant(execution.policyIdHash.toLowerCase() === rmtUniswapV3PolicyIdHash(execution.policyId).toLowerCase(), "policy ID hash changed");
  invariant(execution.policyVersion === commitment.feePolicyVersion, "policy version changed");
  invariant(execution.policyHash.toLowerCase() === commitment.feePolicyHash.toLowerCase(), "policy hash changed");
  invariant(getAddress(execution.treasury) === getAddress(commitment.treasury), "treasury changed");
  invariant(execution.feeBps === commitment.feeBps && execution.feeSide === commitment.feeSide, "fee policy changed");
  invariant(execution.expectedFeeAtomic === commitment.expectedFeeAtomic && execution.maximumFeeAtomic === commitment.maximumFeeAtomic, "fee authority changed");
  invariant(execution.userGrossInputAtomic === economics.userGrossInputAtomic, "gross input changed");
  invariant(execution.providerInputAtomic === economics.providerInputAtomic, "provider input changed");
  invariant(execution.providerGrossExpectedOutputAtomic === economics.providerGrossExpectedOutputAtomic, "gross output changed");
  invariant(execution.protectedUserNetOutputAtomic === economics.protectedUserNetOutputAtomic, "protected net output changed");
  invariant(execution.routeIdentity.toLowerCase() === rmtUniswapV3RouteIdentity(execution.route).toLowerCase(), "route identity changed");
  invariant(execution.route.tokenIn !== execution.route.tokenOut, "route assets match");
  invariant([100, 500, 3_000, 10_000].includes(execution.route.fee0), "first fee tier is unsupported");
  if (execution.route.kind === 0) {
    invariant(execution.route.fee1 === 0 && execution.route.pool1 === zeroAddress, "direct route contains a second leg");
  } else {
    invariant(execution.route.tokenIn !== ROBINHOOD_WETH_ADDRESS && execution.route.tokenOut !== ROBINHOOD_WETH_ADDRESS, "WETH hop is redundant");
    invariant([100, 500, 3_000, 10_000].includes(execution.route.fee1) && execution.route.pool1 !== zeroAddress, "second route leg is invalid");
  }
  atomic(execution.expectedFeeAtomic, "expected fee", true);
  atomic(execution.maximumFeeAtomic, "maximum fee", true);
  atomic(execution.routerMinimumGrossOutputAtomic, "router minimum");
  atomic(execution.deadline, "deadline");
  return true;
}

function authorizationTuple(execution: RmtUniswapV3FeeExecution) {
  return {
    executionId: execution.executionId,
    policyIdHash: execution.policyIdHash,
    policyVersion: BigInt(execution.policyVersion),
    policyHash: execution.policyHash,
    feeBps: execution.feeBps,
    feeSide: execution.feeSide === "input" ? 0 : 1,
    feeAsset: execution.feeAsset,
    expectedFeeAtomic: BigInt(execution.expectedFeeAtomic),
    maximumFeeAtomic: BigInt(execution.maximumFeeAtomic),
    trader: execution.trader,
    userGrossInput: BigInt(execution.userGrossInputAtomic),
    providerInput: BigInt(execution.providerInputAtomic),
    expectedGrossOutput: BigInt(execution.providerGrossExpectedOutputAtomic),
    routerMinimumGrossOutput: BigInt(execution.routerMinimumGrossOutputAtomic),
    protectedUserNetOutput: BigInt(execution.protectedUserNetOutputAtomic),
    deadline: BigInt(execution.deadline),
    routeIdentity: execution.routeIdentity
  } as const;
}

export function encodeRmtUniswapV3FeeExecution(execution: RmtUniswapV3FeeExecution) {
  return encodeFunctionData({
    abi: rmtUniswapV3FeeExecutorAbi,
    functionName: execution.feeSide === "input" ? "executeInputFee" : "executeOutputFee",
    args: [authorizationTuple(execution), execution.route]
  });
}

export function assertRmtUniswapV3FeeCalldata(
  data: Hex,
  expected: RmtUniswapV3FeeExecution,
  economics: RmtNetExecutionEconomics
) {
  assertRmtUniswapV3FeeExecution(expected, economics);
  const decoded = decodeFunctionData({ abi: rmtUniswapV3FeeExecutorAbi, data });
  invariant(decoded.functionName === (expected.feeSide === "input" ? "executeInputFee" : "executeOutputFee"), "execution method changed");
  invariant(encodeRmtUniswapV3FeeExecution(expected).toLowerCase() === data.toLowerCase(), "calldata is not the exact canonical encoding");
  return true;
}
