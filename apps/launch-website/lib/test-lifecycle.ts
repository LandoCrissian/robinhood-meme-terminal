import { isLaunchAddress } from "./launch-data";
import { isTransactionHash, testCreationChain } from "./test-creation";

export const testLifecyclePath = "/api/launchpad/test-lifecycle";
export const curveTradeFeeBps = 100;
export const maxCurveSlippageBps = 500;
export const maxCurveBuyWei = 100n * 10n ** 18n;
export const curveBuySignature = "function buy(uint256 minimumTokenOut,uint256 deadline) payable returns (uint256 tokensOut)" as const;
export const curveSellSignature = "function sell(uint256 amountIn,uint256 minimumEthOut,uint256 deadline) returns (uint256 ethOut)" as const;
export const curveGraduateSignature = "function graduate(uint256 deadline)" as const;

const unsigned = /^(?:0|[1-9][0-9]{0,77})$/;
const quantity = /^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/i;
const data = /^0x(?:[0-9a-f]{2}){4,100}$/i;
const maxTokenWei = 100_000_000n * 10n ** 18n;

type Address = `0x${string}`;

export type TestLifecycleOperation = "buy" | "sell" | "approve" | "graduate";

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
};

export type TestLifecycleQuote = {
  inputWei: string;
  outputWei: string;
  minimumOutputWei: string;
  feeWei: string;
  refundWei: string;
  gasUnits: string;
  gasPriceWei: string;
};

export type TestLifecycleVerification = {
  status: "pending" | "confirmed" | "reverted" | "unavailable";
  transactionHash?: Address;
  indexed?: boolean;
  settlementPending?: boolean;
  outputWei?: string;
  feeWei?: string;
  refundWei?: string;
};

const address = (value: unknown): value is Address => isLaunchAddress(value) && !/^0x0{40}$/i.test(value);
export const sameLifecycleValue = (left: string | undefined | null, right: string | undefined | null) =>
  typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();

export function isLifecycleOperation(value: unknown): value is TestLifecycleOperation {
  return value === "buy" || value === "sell" || value === "approve" || value === "graduate";
}

export function isLifecycleAmount(operation: TestLifecycleOperation, value: unknown): value is string {
  if (typeof value !== "string" || !unsigned.test(value)) return false;
  const amount = BigInt(value);
  if (operation === "graduate") return amount === 0n;
  return amount > 0n && amount <= (operation === "buy" ? maxCurveBuyWei : maxTokenWei);
}

export function isLifecycleSlippage(operation: TestLifecycleOperation, value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    && value <= (operation === "buy" || operation === "sell" ? maxCurveSlippageBps : 0);
}

export function isTestLifecycleRequest(value: unknown): value is TestLifecycleRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Partial<TestLifecycleRequest>;
  if (Object.keys(r).length !== 17 || !isLifecycleOperation(r.operation) || !address(r.token) || !address(r.curve)
      || !address(r.factory) || !address(r.from) || !address(r.to) || r.chainId !== testCreationChain
      || typeof r.data !== "string" || !data.test(r.data) || typeof r.value !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(r.value)
      || typeof r.nonce !== "string" || !quantity.test(r.nonce) || BigInt(r.nonce) >= BigInt(Number.MAX_SAFE_INTEGER)
      || typeof r.blockNumber !== "string" || !quantity.test(r.blockNumber) || BigInt(r.blockNumber) === 0n
      || typeof r.reviewBlockNumber !== "string" || !quantity.test(r.reviewBlockNumber) || BigInt(r.reviewBlockNumber) < BigInt(r.blockNumber)
      || !isTransactionHash(r.blockHash) || !isTransactionHash(r.reviewBlockHash) || typeof r.deadline !== "string"
      || !/^[1-9][0-9]{0,15}$/.test(r.deadline) || !isLifecycleAmount(r.operation, r.amountWei)
      || !isLifecycleSlippage(r.operation, r.slippageBps) || typeof r.minimumOutputWei !== "string" || !unsigned.test(r.minimumOutputWei)) return false;
  const trades = r.operation === "sell" || r.operation === "buy";
  return trades === (BigInt(r.minimumOutputWei) > 0n) && BigInt(r.minimumOutputWei) < 2n ** 256n
    && BigInt(r.value) === (r.operation === "buy" ? BigInt(r.amountWei) : 0n)
    && sameLifecycleValue(r.to, r.operation === "approve" ? r.token : r.curve);
}

export function sameTestLifecycleRequest(a: TestLifecycleRequest, b: TestLifecycleRequest) {
  const keys = Object.keys(a) as (keyof TestLifecycleRequest)[];
  return keys.every(key => {
    const left = a[key];
    const right = b[key];
    return typeof left === "string" && typeof right === "string" ? sameLifecycleValue(left, right) : left === right;
  });
}

export async function lifecycleCalldataMatches(request: TestLifecycleRequest) {
  const { encodeFunctionData, erc20Abi, parseAbi } = await import("viem");
  const abi = parseAbi([curveBuySignature, curveSellSignature, curveGraduateSignature]);
  const deadline = BigInt(request.deadline);
  const amount = BigInt(request.amountWei);
  const min = BigInt(request.minimumOutputWei);
  const encoded = request.operation === "approve"
    ? encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [request.curve, amount] })
    : request.operation === "buy" ? encodeFunctionData({ abi, functionName: "buy", args: [min, deadline] })
    : request.operation === "sell" ? encodeFunctionData({ abi, functionName: "sell", args: [amount, min, deadline] })
    : encodeFunctionData({ abi, functionName: "graduate", args: [deadline] });
  return sameLifecycleValue(request.data, encoded);
}
