import { decodeFunctionData, encodeFunctionData, parseAbi } from "viem";
import { reclaimCampaignSignatures, reclaimFactorySignatures } from "../../../packages/launchpad-common/reclaim-runtime.mjs";
import type { ReclaimReview } from "./reclaim";

// Browser-safe source-bound ABI. Unknown selectors and trailing/noncanonical
// bytes cannot acquire meaning from a friendly operation label or hash alone.
const abi = parseAbi([...reclaimFactorySignatures, ...reclaimCampaignSignatures].filter(line => line.startsWith("function ")).concat([
  "function approve(address spender,uint256 amount) returns(bool)", "function setApprovalForAll(address operator,bool approved)",
]));
const same = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const integer = (v: unknown, bits = 256): v is bigint | number => (typeof v === "bigint" || typeof v === "number" && Number.isSafeInteger(v))
  && BigInt(v) >= 0n && BigInt(v) < 2n ** BigInt(bits);
const hash = (v: unknown) => typeof v === "string" && /^0x[0-9a-f]{64}$/i.test(v) && BigInt(v) > 0n;
const numberEquals = (value: unknown, expected: string | undefined) => integer(value) && expected !== undefined && BigInt(value) === BigInt(expected);
const arrayEquals = (value: unknown, expected: string[] | undefined) => Array.isArray(value) && !!expected && value.length === expected.length
  && value.every((item, i) => numberEquals(item, expected[i]));

export function reclaimCalldataMatchesReview(review: ReclaimReview): boolean {
  try {
    const decoded = decodeFunctionData({ abi, data: review.innerCall.data });
    if (!same(encodeFunctionData({ abi, functionName: decoded.functionName, args: decoded.args }), review.innerCall.data)) return false;
    const args = (decoded.args ?? []) as readonly unknown[], field = review.fields;
    const named = (name: string, size: number) => decoded.functionName === name && args.length === size;
    const empty: Partial<Record<ReclaimReview["operation"], string>> = {
      "execute-collection": "executeCollection", "cancel-collection": "cancelCollection", pause: "pause", resume: "resume",
      "execute-rate": "executeRate", "cancel-rate": "cancelRate", "execute-close": "executeClose", "cancel-close": "cancelClose",
      "execute-recovery": "executeRecovery", "cancel-recovery": "cancelRecovery", "accept-controller": "acceptController", "cancel-controller": "cancelController",
    };
    if (empty[review.operation]) return named(empty[review.operation]!, 0);
    switch (review.operation) {
      case "create-campaign": return named("create", 4) && same(args[0], field.intentId) && same(args[1], field.controller)
        && numberEquals(args[2], field.rewardPerUnit) && integer(args[2], 128) && numberEquals(args[3], field.walletCap) && integer(args[3], 32);
      case "approve-funding": return named("approve", 2) && same(args[0], review.campaign) && numberEquals(args[1], field.amountWei);
      case "approve-return": return named("approve", 2) && same(args[0], review.campaign) && numberEquals(args[1], review.rewardWei);
      case "fund": return named("fund", 1) && numberEquals(args[0], field.amountWei);
      case "propose-collection": return named("proposeCollection", 7) && same(args[0], field.collection) && [1, 2].includes(Number(args[1]))
        && hash(args[2]) && hash(args[3]) && numberEquals(args[4], field.collectionCap) && integer(args[4], 32)
        && numberEquals(args[5], field.collectionWalletCap) && integer(args[5], 32) && numberEquals(args[6], field.expiresAt) && integer(args[6], 48);
      case "disable-collection": return named("disableCollection", 1) && same(args[0], field.collection);
      case "approve-721": return named("approve", 2) && same(args[0], review.campaign) && numberEquals(args[1], field.tokenId);
      case "approve-1155": case "revoke-1155": return named("setApprovalForAll", 2) && same(args[0], review.campaign) && args[1] === (review.operation === "approve-1155");
      case "redeem": {
        if (!named("redeem", 9) || !same(args[0], field.collection) || !arrayEquals(args[1], field.tokenIds) || !arrayEquals(args[2], field.quantities)
          || !Array.isArray(args[3]) || args[3].length !== field.tokenIds?.length || !Array.isArray(args[4]) || args[4].length !== field.tokenIds.length
          || !numberEquals(args[5], review.policyEpoch) || !integer(args[5], 64) || !numberEquals(args[6], review.rewardWei)
          || !integer(args[7], 64) || !numberEquals(args[8], String(review.expiresAt)) || !integer(args[8], 48)) return false;
        return args[3].every((maximum, index) => integer(maximum) && BigInt(maximum) >= BigInt(field.quantities![index]) && BigInt(maximum) > 0n)
          && args[4].every(proof => Array.isArray(proof) && proof.length <= 32 && proof.every(hash));
      }
      case "return": return named("returnTradeIn", 2) && numberEquals(args[0], field.receiptId) && integer(args[0], 64)
        && numberEquals(args[1], String(review.expiresAt)) && integer(args[1], 48);
      case "propose-rate": return named("proposeRate", 2) && numberEquals(args[0], field.rewardPerUnit) && integer(args[0], 128) && numberEquals(args[1], field.expiresAt) && integer(args[1], 48);
      case "propose-close": return named("proposeClose", 1) && numberEquals(args[0], field.expiresAt) && integer(args[0], 48);
      case "propose-recovery": return named("proposeRecovery", 2) && numberEquals(args[0], field.amountWei) && numberEquals(args[1], field.expiresAt) && integer(args[1], 48);
      case "propose-controller": return named("proposeController", 2) && same(args[0], field.next) && numberEquals(args[1], field.expiresAt) && integer(args[1], 48);
      default: return false;
    }
  } catch { return false; }
}
