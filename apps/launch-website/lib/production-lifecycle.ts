import { encodeFunctionData, erc20Abi, parseAbi, type Address, type Hex } from "viem";
import { isLaunchAddress } from "./launch-data";
import { isTransactionHash } from "./test-creation";
import { curveBuySignature, curveGraduateSignature, curveSellSignature, isLifecycleAmount, isLifecycleSlippage,
  isLifecycleTrade, sameLifecycleValue, type TestLifecycleQuote, type TestLifecycleState, type TestLifecycleVerification } from "./test-lifecycle";
import { encodeTestV4Swap, isTestV4Binding, sameTestV4Binding, testPermit2Lifetime, testV4PermitSignature, testV4PoolId, type TestV4Binding } from "./test-v4";

export const productionLifecyclePath = "/api/launchpad/production-lifecycle";
export const productionLifecycleChain = "0x1237" as const;
// Public addresses only. The server independently verifies every runtime and binding.
export const productionTradingPins = Object.freeze({
  factory: "0x7281e1F9D8764Ae6533b374DFd08AB2ECbC273c3" as Address,
  engine: "0x10e540536F10ed36E5fC6638638f1d862e552D32" as Address,
  guard: "0x998F3C0CE20cFF92655D495a159B1Ca37c162000" as Address,
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
  router: "0x204FAca1764B154221e35c0d20aBb3c525710498" as Address,
});
export type ProductionLifecycleOperation = "buy" | "buy-graduate" | "sell" | "approve" | "graduate" | "v4-buy" | "v4-sell" | "v4-token-approve" | "v4-permit2-approve";
export type ProductionLifecycleRequest = {
  operation: ProductionLifecycleOperation; token: Address; curve: Address; factory: Address; from: Address; to: Address;
  data: Hex; value: Hex; chainId: typeof productionLifecycleChain; nonce: Hex; blockNumber: Hex; blockHash: Hex;
  reviewBlockNumber: Hex; reviewBlockHash: Hex; deadline: string; amountWei: string; minimumOutputWei: string;
  slippageBps: number; approvalBinding: string; walletCodeHash: Hex; v4?: TestV4Binding;
};
export type ProductionLifecycleState = TestLifecycleState;
export type ProductionNitroZeroPosterEvidence = { profile: "nitro-zero-poster-v1"; chainId: 4663; l1BaseFeeWei: "0"; l1CalldataUnitWei: "0";
  l2BaseFeeWei: string; nativeL2BaseFeeWei: string; blockNumber: string; blockHash: Hex };
export type ProductionLifecycleQuote = TestLifecycleQuote & { maxPriorityFeePerGasWei: string; outputImpactBps?: number | null } & (
  { feeEvidence: "verified-nitro"; l1PosterGasUnits: string; nitroZeroPosterPolicy?: never; transactionBaseFeeWei?: never; observedGasPriceWei?: never }
  | { feeEvidence: "verified-nitro-zero-poster"; l1PosterGasUnits: "0"; nitroZeroPosterPolicy: ProductionNitroZeroPosterEvidence;
    transactionBaseFeeWei: string; observedGasPriceWei: string });
export function isProductionNitroZeroPosterEvidence(value: unknown): value is ProductionNitroZeroPosterEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as ProductionNitroZeroPosterEvidence;
  return Object.keys(p).length === 8 && ["profile", "chainId", "l1BaseFeeWei", "l1CalldataUnitWei", "l2BaseFeeWei", "nativeL2BaseFeeWei", "blockNumber", "blockHash"].every(k => Object.hasOwn(p, k))
    && p.profile === "nitro-zero-poster-v1" && p.chainId === 4663 && p.l1BaseFeeWei === "0" && p.l1CalldataUnitWei === "0"
    && typeof p.l2BaseFeeWei === "string" && /^[1-9][0-9]{0,77}$/.test(p.l2BaseFeeWei) && BigInt(p.l2BaseFeeWei) < 2n ** 256n
    && typeof p.nativeL2BaseFeeWei === "string" && /^[1-9][0-9]{0,77}$/.test(p.nativeL2BaseFeeWei) && BigInt(p.nativeL2BaseFeeWei) < 2n ** 256n
    && typeof p.blockNumber === "string" && /^[1-9][0-9]{0,15}$/.test(p.blockNumber) && isTransactionHash(p.blockHash);
}
export type ProductionLifecycleVerification = TestLifecycleVerification;
export const isProductionLifecycleOperation = (v: unknown): v is ProductionLifecycleOperation =>
  ["buy", "buy-graduate", "sell", "approve", "graduate", "v4-buy", "v4-sell", "v4-token-approve", "v4-permit2-approve"].includes(v as string);
export const tradeTermsOperation = (operation: ProductionLifecycleOperation) => operation === "buy-graduate" ? "buy" : operation;
export const isProductionV4Operation = (v: ProductionLifecycleOperation) => v.startsWith("v4-");
export function productionLifecycleDestination(operation: ProductionLifecycleOperation, token: Address, curve: Address) {
  if (operation === "approve" || operation === "v4-token-approve") return token;
  if (operation === "v4-permit2-approve") return productionTradingPins.permit2;
  if (operation === "v4-buy" || operation === "v4-sell") return productionTradingPins.router;
  return curve;
}
const quantity = /^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/i;
const uint = /^(?:0|[1-9][0-9]{0,77})$/;
export function isProductionLifecycleRequest(value: unknown): value is ProductionLifecycleRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Partial<ProductionLifecycleRequest>;
  if (!isProductionLifecycleOperation(r.operation) || ![r.token, r.curve, r.factory, r.from, r.to].every(a => isLaunchAddress(a) && !/^0x0{40}$/i.test(a!))
      || r.chainId !== productionLifecycleChain || !sameLifecycleValue(r.factory, productionTradingPins.factory)
      || typeof r.data !== "string" || !/^0x(?:[0-9a-f]{2}){4,1600}$/i.test(r.data)
      || typeof r.value !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(r.value)
      || typeof r.nonce !== "string" || !quantity.test(r.nonce) || BigInt(r.nonce) >= BigInt(Number.MAX_SAFE_INTEGER)
      || typeof r.blockNumber !== "string" || !quantity.test(r.blockNumber) || BigInt(r.blockNumber) === 0n
      || typeof r.reviewBlockNumber !== "string" || !quantity.test(r.reviewBlockNumber) || BigInt(r.reviewBlockNumber) < BigInt(r.blockNumber)
      || !isTransactionHash(r.blockHash) || !isTransactionHash(r.reviewBlockHash) || !isTransactionHash(r.walletCodeHash)
      || typeof r.approvalBinding !== "string" || !/^[0-9a-f]{64}$/i.test(r.approvalBinding)
      || typeof r.deadline !== "string" || !/^[1-9][0-9]{0,15}$/.test(r.deadline)
      || !isLifecycleAmount(tradeTermsOperation(r.operation), r.amountWei) || !isLifecycleSlippage(tradeTermsOperation(r.operation), r.slippageBps)
      || typeof r.minimumOutputWei !== "string" || !uint.test(r.minimumOutputWei)) return false;
  const v4 = isProductionV4Operation(r.operation);
  if (Object.keys(r).length !== (v4 ? 21 : 20) || (v4 ? !isTestV4Binding(r.v4, r.token!)
      || !sameLifecycleValue(r.v4.engine, productionTradingPins.engine) || !sameLifecycleValue(r.v4.poolKey.hooks, productionTradingPins.guard) : Object.hasOwn(r, "v4"))) return false;
  return isLifecycleTrade(tradeTermsOperation(r.operation)) === (BigInt(r.minimumOutputWei) > 0n)
    && BigInt(r.minimumOutputWei) < (v4 ? 2n ** 127n : 2n ** 256n)
    && BigInt(r.value) === (tradeTermsOperation(r.operation) === "buy" || r.operation === "v4-buy" ? BigInt(r.amountWei) : 0n)
    && sameLifecycleValue(r.to, productionLifecycleDestination(r.operation, r.token!, r.curve!));
}
export function sameProductionLifecycleRequest(a: ProductionLifecycleRequest, b: ProductionLifecycleRequest) {
  return Object.keys(a).length === Object.keys(b).length && (Object.keys(a) as (keyof ProductionLifecycleRequest)[]).every(key =>
    key === "v4" ? sameTestV4Binding(a.v4, b.v4) : typeof a[key] === "string" && typeof b[key] === "string"
      ? sameLifecycleValue(a[key] as string, b[key] as string) : a[key] === b[key]);
}
export async function encodeProductionLifecycleCalldata(operation: ProductionLifecycleOperation, token: Address, curve: Address,
  amount: bigint, minimum: bigint, deadline: bigint, v4?: TestV4Binding): Promise<Hex> {
  const abi = parseAbi([curveBuySignature, curveSellSignature, curveGraduateSignature]);
  switch (operation) {
    case "v4-buy": case "v4-sell":
      if (!v4) throw Error("Verified production PoolKey required");
      return encodeTestV4Swap(v4.poolKey, operation === "v4-buy", amount, minimum, deadline);
    case "approve": case "v4-token-approve": return encodeFunctionData({ abi: erc20Abi, functionName: "approve",
      args: [operation === "approve" ? curve : productionTradingPins.permit2, amount] });
    case "v4-permit2-approve": return encodeFunctionData({ abi: parseAbi([testV4PermitSignature]), functionName: "approve",
      args: [token, productionTradingPins.router, amount, Number(deadline + testPermit2Lifetime)] });
    case "buy-graduate": return encodeFunctionData({ abi: parseAbi(["function buyAndGraduate(uint256,uint256) payable returns(uint256)"]), functionName:"buyAndGraduate", args:[minimum, deadline] });
    case "buy": return encodeFunctionData({ abi, functionName: "buy", args: [minimum, deadline] });
    case "sell": return encodeFunctionData({ abi, functionName: "sell", args: [amount, minimum, deadline] });
    case "graduate": return encodeFunctionData({ abi, functionName: "graduate", args: [deadline] });
  }
}
export async function productionLifecycleCalldataMatches(r: ProductionLifecycleRequest) {
  return (!r.v4 || sameLifecycleValue(await testV4PoolId(r.v4.poolKey), r.v4.poolId))
    && sameLifecycleValue(r.data, await encodeProductionLifecycleCalldata(r.operation, r.token, r.curve,
      BigInt(r.amountWei), BigInt(r.minimumOutputWei), BigInt(r.deadline), r.v4));
}
