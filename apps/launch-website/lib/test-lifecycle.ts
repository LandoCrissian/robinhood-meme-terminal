import { isLaunchAddress } from "./launch-data";
import { isTransactionHash, testCreationChain } from "./test-creation";
import { encodeTestV4Swap, isTestV4Binding, sameTestV4Binding, testLpClaimSignature, testLpCollectSignature, testPermit2Lifetime,
  testV4PermitSignature, testV4Pins, testV4PoolId, type TestLpAmounts, type TestV4Binding } from "./test-v4";

export const testLifecyclePath = "/api/launchpad/test-lifecycle";
export const curveTradeFeeBps = 100;
export const maxCurveSlippageBps = 500;
export const maxCurveBuyWei = 100n * 10n ** 18n;
export const curveBuySignature = "function buy(uint256 minimumTokenOut,uint256 deadline) payable returns (uint256 tokensOut)" as const;
export const curveSellSignature = "function sell(uint256 amountIn,uint256 minimumEthOut,uint256 deadline) returns (uint256 ethOut)" as const;
export const curveGraduateSignature = "function graduate(uint256 deadline)" as const;

const unsigned = /^(?:0|[1-9][0-9]{0,77})$/;
const quantity = /^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/i;
const data = /^0x(?:[0-9a-f]{2}){4,1600}$/i;
const maxTokenWei = 100_000_000n * 10n ** 18n;

type Address = `0x${string}`;

export type TestV4Operation = "v4-buy" | "v4-sell" | "v4-token-approve" | "v4-permit2-approve" | "lp-collect" | "lp-claim";
export type TestLifecycleOperation = "buy" | "sell" | "approve" | "graduate" | TestV4Operation;

export type TestLifecycleRequest = {
  operation: TestLifecycleOperation;
  token: Address;
  curve: Address;
  factory: Address;
  from: Address;
  to: Address;
  data: Address;
  value: Address;
  chainId: typeof testCreationChain;
  nonce: Address;
  blockNumber: Address;
  blockHash: Address;
  reviewBlockNumber: Address;
  reviewBlockHash: Address;
  deadline: string;
  amountWei: string;
  minimumOutputWei: string;
  slippageBps: number;
  v4?: TestV4Binding;
};

export type TestLifecycleState = {
  factory: Address;
  token: Address;
  curve: Address;
  phase: "curve" | "eligible" | "graduated";
  blockNumber: Address;
  blockHash: Address;
  inventoryWei: string;
  backingWei: string;
  soldWei: string;
  totalSupplyWei: string;
  targetBackingWei: string;
  targetSoldWei: string;
  feeBps: number;
  priceWei: string | null;
  account?: { ethWei: string; tokenWei: string; allowanceWei: string };
  postGraduation?: {
    poolId: Address;
    poolKey: TestV4Binding["poolKey"];
    router: Address;
    permit2: Address;
    ledger: Address;
    feeBps: 30;
    balances?: { erc20AllowanceWei: string; permit2AllowanceWei: string; permit2Expiration: number; chainTimestamp: number };
    fees: { uncollected: TestLpAmounts; collected: TestLpAmounts; claimed: TestLpAmounts; claimable?: TestLpAmounts };
  };
};

export type TestLifecycleQuote = {
  inputWei: string;
  outputWei: string;
  minimumOutputWei: string;
  feeWei: string;
  refundWei: string;
  gasUnits: string;
  gasPriceWei: string;
  feePips?: number;
  feeAsset?: "native" | "token";
  lpAmounts?: TestLpAmounts;
};

export type TestLifecycleVerification = {
  status: "pending" | "confirmed" | "reverted" | "unavailable";
  transactionHash?: Address;
  indexed?: boolean;
  settlementPending?: boolean;
  outputWei?: string;
  feeWei?: string;
  refundWei?: string;
  lpAmounts?: TestLpAmounts;
};

const address = (value: unknown): value is Address => isLaunchAddress(value) && !/^0x0{40}$/i.test(value);
export const sameLifecycleValue = (left: string | undefined | null, right: string | undefined | null) =>
  typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();

export function isLifecycleOperation(value: unknown): value is TestLifecycleOperation {
  return value === "buy" || value === "sell" || value === "approve" || value === "graduate" || isTestV4Operation(value);
}

export function isTestV4Operation(value: unknown): value is TestV4Operation {
  return value === "v4-buy" || value === "v4-sell" || value === "v4-token-approve" || value === "v4-permit2-approve"
    || value === "lp-collect" || value === "lp-claim";
}

export function isLifecycleTrade(operation: TestLifecycleOperation) {
  return operation === "buy" || operation === "sell" || operation === "v4-buy" || operation === "v4-sell";
}

export function isLifecycleAmount(operation: TestLifecycleOperation, value: unknown): value is string {
  if (typeof value !== "string" || !unsigned.test(value)) return false;
  const amount = BigInt(value);
  if (operation === "graduate" || operation === "lp-collect" || operation === "lp-claim") return amount === 0n;
  return amount > 0n && amount <= (operation === "buy" || operation === "v4-buy" ? maxCurveBuyWei : maxTokenWei);
}

export function isLifecycleSlippage(operation: TestLifecycleOperation, value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= (operation === "v4-buy" || operation === "v4-sell" ? 10 : 0)
    && value <= (isLifecycleTrade(operation) ? maxCurveSlippageBps : 0);
}

export function isTestLifecycleRequest(value: unknown): value is TestLifecycleRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Partial<TestLifecycleRequest>;
  if (!isLifecycleOperation(r.operation) || !address(r.token) || !address(r.curve)
      || !address(r.factory) || !address(r.from) || !address(r.to) || r.chainId !== testCreationChain
      || typeof r.data !== "string" || !data.test(r.data) || typeof r.value !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(r.value)
      || typeof r.nonce !== "string" || !quantity.test(r.nonce) || BigInt(r.nonce) >= BigInt(Number.MAX_SAFE_INTEGER)
      || typeof r.blockNumber !== "string" || !quantity.test(r.blockNumber) || BigInt(r.blockNumber) === 0n
      || typeof r.reviewBlockNumber !== "string" || !quantity.test(r.reviewBlockNumber) || BigInt(r.reviewBlockNumber) < BigInt(r.blockNumber)
      || !isTransactionHash(r.blockHash) || !isTransactionHash(r.reviewBlockHash) || typeof r.deadline !== "string"
      || !/^[1-9][0-9]{0,15}$/.test(r.deadline) || !isLifecycleAmount(r.operation, r.amountWei)
      || !isLifecycleSlippage(r.operation, r.slippageBps) || typeof r.minimumOutputWei !== "string" || !unsigned.test(r.minimumOutputWei)) return false;
  const isV4 = isTestV4Operation(r.operation);
  if (Object.keys(r).length !== (isV4 ? 19 : 18) || (isV4 ? !isTestV4Binding(r.v4, r.token) : Object.hasOwn(r, "v4"))) return false;
  const minimum = BigInt(r.minimumOutputWei);
  return isLifecycleTrade(r.operation) === (minimum > 0n) && minimum < (isV4 ? 2n ** 127n : 2n ** 256n)
    && BigInt(r.value) === (r.operation === "buy" || r.operation === "v4-buy" ? BigInt(r.amountWei) : 0n)
    && sameLifecycleValue(r.to, lifecycleDestination(r.operation, r.token, r.curve, r.v4));
}

export function lifecycleDestination(operation: TestLifecycleOperation, token: Address, curve: Address, v4?: TestV4Binding) {
  switch (operation) {
    case "approve": case "v4-token-approve": return token;
    case "v4-permit2-approve": return testV4Pins.permit2.address;
    case "v4-buy": case "v4-sell": return testV4Pins.router.address;
    case "lp-collect": return v4?.engine;
    case "lp-claim": return v4?.ledger;
    default: return curve;
  }
}

export function sameTestLifecycleRequest(a: TestLifecycleRequest, b: TestLifecycleRequest) {
  const keys = Object.keys(a) as (keyof TestLifecycleRequest)[];
  return keys.every(key => {
    if (key === "v4") return sameTestV4Binding(a.v4, b.v4);
    const left = a[key];
    const right = b[key];
    return typeof left === "string" && typeof right === "string" ? sameLifecycleValue(left, right) : left === right;
  });
}

export async function lifecycleCalldataMatches(request: TestLifecycleRequest) {
  if (request.v4 && !sameLifecycleValue(await testV4PoolId(request.v4.poolKey), request.v4.poolId)) return false;
  return sameLifecycleValue(request.data, await encodeLifecycleCalldata(request.operation, request.token, request.curve,
    BigInt(request.amountWei), BigInt(request.minimumOutputWei), BigInt(request.deadline), request.v4));
}

export async function encodeLifecycleCalldata(operation: TestLifecycleOperation, token: Address, curve: Address,
  amount: bigint, minimum: bigint, deadline: bigint, v4?: TestV4Binding) {
  const { encodeFunctionData, erc20Abi, parseAbi } = await import("viem");
  const abi = parseAbi([curveBuySignature, curveSellSignature, curveGraduateSignature]);
  switch (operation) {
    case "v4-buy": case "v4-sell":
      if (!v4) throw new Error("Verified PoolKey is required");
      return encodeTestV4Swap(v4.poolKey, operation === "v4-buy", amount, minimum, deadline);
    case "v4-token-approve": case "approve":
      return encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [operation === "approve" ? curve : testV4Pins.permit2.address, amount] });
    case "v4-permit2-approve":
      return encodeFunctionData({ abi: parseAbi([testV4PermitSignature]), functionName: "approve",
        args: [token, testV4Pins.router.address, amount, Number(deadline + testPermit2Lifetime)] });
    case "lp-claim": return encodeFunctionData({ abi: parseAbi([testLpClaimSignature]), functionName: "claim" });
    case "lp-collect": return encodeFunctionData({ abi: parseAbi([testLpCollectSignature]), functionName: "collectLpFees", args: [token, deadline] });
    case "buy": return encodeFunctionData({ abi, functionName: "buy", args: [minimum, deadline] });
    case "sell": return encodeFunctionData({ abi, functionName: "sell", args: [amount, minimum, deadline] });
    case "graduate": return encodeFunctionData({ abi, functionName: "graduate", args: [deadline] });
  }
}
