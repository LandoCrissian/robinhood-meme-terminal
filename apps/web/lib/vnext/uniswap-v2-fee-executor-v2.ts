import {
  decodeFunctionData, encodeAbiParameters, encodeFunctionData, getAddress, isAddress, keccak256,
  parseAbiParameters, stringToHex, zeroAddress, type Address, type Hex
} from "viem";
import { assertRmtExecutionFeeV2Economics, type RmtExecutionFeeV2Economics } from "./execution-fee-policy-v2";
import { ROBINHOOD_WETH_ADDRESS, isRobinhoodNativeAsset } from "./robinhood-assets";

export const RMT_UNISWAP_V2_V2_PROVIDER_ID = keccak256(stringToHex("RMT_UNISWAP_V2_ROUTER_V2"));
export const RMT_UNISWAP_V2_V2_POLICY_ID_HASH = keccak256(stringToHex("RMT_EXECUTION_V2"));
export const RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID = "rmt-uniswap-v2-fee-executor-v2" as const;
const ROUTE_DOMAIN = keccak256(stringToHex("RMT_UNISWAP_V2_ROUTE_V2"));

export const rmtUniswapV2FeeExecutorV2Abi = [{
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
    { name: "tokenOut", type: "address" }, { name: "pair0", type: "address" },
    { name: "pair1", type: "address" }
  ] }],
  outputs: [{ name: "actualProviderOutput", type: "uint256" }, { name: "actualRmtFee", type: "uint256" }]
}] as const;

export type RmtUniswapV2FeeRouteV2 = {
  kind: 0 | 1; tokenIn: Address; tokenOut: Address; pair0: Address; pair1: Address;
};

export type RmtUniswapV2FeeExecutionV2 = {
  executor: Address; executorRuntimeHash: Hex; executionId: Hex; policyIdHash: Hex; policyVersion: 2;
  policyHash: Hex; feeBps: 25; feeSide: "input"; feeAsset: Address; treasury: Address; trader: Address;
  requestedInputAsset: Address; requestedOutputAsset: Address; routedInputAsset: Address; routedOutputAsset: Address;
  userGrossInputAtomic: string; expectedFeeAtomic: string; maximumFeeAtomic: string; providerInputAtomic: string;
  providerExpectedOutputAtomic: string; protectedOutputAtomic: string; deadline: string; routeIdentity: Hex;
  route: RmtUniswapV2FeeRouteV2;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`RMT rejected inconsistent Uniswap V2 V2 authority: ${message}.`);
}
function exactAddress(value: string, label: string) {
  invariant(isAddress(value, { strict: false }), `${label} is invalid`); return getAddress(value);
}
function atomic(value: string, label: string, allowZero = false) {
  invariant(/^(0|[1-9][0-9]*)$/.test(value), `${label} is not canonical`);
  const amount = BigInt(value); invariant(allowZero || amount > 0n, `${label} must be positive`); return amount;
}
function addressFromAssetId(assetId: string) {
  return assetId.endsWith("/native") ? zeroAddress : exactAddress(assetId.slice(assetId.lastIndexOf(":") + 1), "economics asset");
}

export function rmtUniswapV2RouteIdentityV2(route: RmtUniswapV2FeeRouteV2) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32 domain, uint8 kind, address tokenIn, address tokenOut, address pair0, address pair1"),
    [ROUTE_DOMAIN, route.kind, route.tokenIn, route.tokenOut, route.pair0, route.pair1]
  ));
}

export function createRmtUniswapV2FeeExecutionV2(input: {
  executor: string; executorRuntimeHash: Hex; executionId: Hex; economics: RmtExecutionFeeV2Economics;
  trader: string; inputAsset: string; outputAsset: string; deadline: string; route: RmtUniswapV2FeeRouteV2;
}) {
  assertRmtExecutionFeeV2Economics(input.economics);
  const requestedInputAsset = exactAddress(input.inputAsset, "requested input");
  const requestedOutputAsset = exactAddress(input.outputAsset, "requested output");
  const route = {
    ...input.route, tokenIn: exactAddress(input.route.tokenIn, "routed input"),
    tokenOut: exactAddress(input.route.tokenOut, "routed output"), pair0: exactAddress(input.route.pair0, "first pair"),
    pair1: exactAddress(input.route.pair1, "second pair")
  };
  const execution: RmtUniswapV2FeeExecutionV2 = {
    executor: exactAddress(input.executor, "executor"), executorRuntimeHash: input.executorRuntimeHash,
    executionId: input.executionId, policyIdHash: RMT_UNISWAP_V2_V2_POLICY_ID_HASH, policyVersion: 2,
    policyHash: input.economics.policyHash, feeBps: 25, feeSide: "input",
    feeAsset: addressFromAssetId(input.economics.feeAsset), treasury: getAddress(input.economics.treasury),
    trader: exactAddress(input.trader, "trader"), requestedInputAsset, requestedOutputAsset,
    routedInputAsset: route.tokenIn, routedOutputAsset: route.tokenOut,
    userGrossInputAtomic: input.economics.userGrossInputAtomic, expectedFeeAtomic: input.economics.expectedFeeAtomic,
    maximumFeeAtomic: input.economics.maximumFeeAtomic, providerInputAtomic: input.economics.providerInputAtomic,
    providerExpectedOutputAtomic: input.economics.providerGrossExpectedOutputAtomic,
    protectedOutputAtomic: input.economics.providerProtectedOutputAtomic,
    deadline: atomic(input.deadline, "deadline").toString(), routeIdentity: rmtUniswapV2RouteIdentityV2(route), route
  };
  assertRmtUniswapV2FeeExecutionV2(execution, input.economics); return execution;
}

export function assertRmtUniswapV2FeeExecutionV2(execution: RmtUniswapV2FeeExecutionV2, economics: RmtExecutionFeeV2Economics) {
  assertRmtExecutionFeeV2Economics(economics);
  invariant(/^0x[0-9a-fA-F]{64}$/.test(execution.executorRuntimeHash), "executor runtime hash is invalid");
  invariant(/^0x[0-9a-fA-F]{64}$/.test(execution.executionId) && execution.executionId !== `0x${"0".repeat(64)}`, "execution ID is invalid");
  invariant(execution.policyIdHash.toLowerCase() === RMT_UNISWAP_V2_V2_POLICY_ID_HASH.toLowerCase(), "policy ID changed");
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
  invariant(execution.routedInputAsset === (isRobinhoodNativeAsset(execution.requestedInputAsset) ? ROBINHOOD_WETH_ADDRESS : execution.requestedInputAsset), "routed input changed");
  invariant(execution.routedOutputAsset === (isRobinhoodNativeAsset(execution.requestedOutputAsset) ? ROBINHOOD_WETH_ADDRESS : execution.requestedOutputAsset), "routed output changed");
  invariant(execution.route.tokenIn === execution.routedInputAsset && execution.route.tokenOut === execution.routedOutputAsset, "route assets changed");
  invariant(execution.routeIdentity.toLowerCase() === rmtUniswapV2RouteIdentityV2(execution.route).toLowerCase(), "route identity changed");
  if (execution.route.kind === 0) invariant(execution.route.pair1 === zeroAddress, "direct route has a second pair");
  else invariant(execution.route.kind === 1 && execution.route.tokenIn !== ROBINHOOD_WETH_ADDRESS && execution.route.tokenOut !== ROBINHOOD_WETH_ADDRESS && execution.route.pair1 !== zeroAddress, "WETH-hop route is invalid");
  atomic(execution.expectedFeeAtomic, "fee", true); atomic(execution.providerInputAtomic, "provider input");
  atomic(execution.protectedOutputAtomic, "protected output"); atomic(execution.deadline, "deadline"); return true;
}

function authorizationTuple(execution: RmtUniswapV2FeeExecutionV2) {
  return {
    executionId: execution.executionId, policyIdHash: execution.policyIdHash, policyVersion: 2n,
    policyHash: execution.policyHash, feeBps: 25, feeSide: 0, feeAsset: execution.feeAsset,
    treasury: execution.treasury, trader: execution.trader, requestedInputAsset: execution.requestedInputAsset,
    requestedOutputAsset: execution.requestedOutputAsset, routedInputAsset: execution.routedInputAsset,
    routedOutputAsset: execution.routedOutputAsset, userGrossInput: BigInt(execution.userGrossInputAtomic),
    expectedFeeAtomic: BigInt(execution.expectedFeeAtomic), maximumFeeAtomic: BigInt(execution.maximumFeeAtomic),
    providerInput: BigInt(execution.providerInputAtomic), expectedProviderOutput: BigInt(execution.providerExpectedOutputAtomic),
    protectedOutput: BigInt(execution.protectedOutputAtomic), deadline: BigInt(execution.deadline), routeIdentity: execution.routeIdentity
  } as const;
}

export function encodeRmtUniswapV2FeeExecutionV2(execution: RmtUniswapV2FeeExecutionV2) {
  return encodeFunctionData({ abi: rmtUniswapV2FeeExecutorV2Abi, functionName: "execute", args: [authorizationTuple(execution), execution.route] });
}

export function assertRmtUniswapV2FeeCalldataV2(data: Hex, expected: RmtUniswapV2FeeExecutionV2, economics: RmtExecutionFeeV2Economics) {
  assertRmtUniswapV2FeeExecutionV2(expected, economics);
  const decoded = decodeFunctionData({ abi: rmtUniswapV2FeeExecutorV2Abi, data });
  invariant(decoded.functionName === "execute", "execution method changed");
  invariant(encodeRmtUniswapV2FeeExecutionV2(expected).toLowerCase() === data.toLowerCase(), "calldata changed"); return true;
}
