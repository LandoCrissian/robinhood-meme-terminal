import { decodeFunctionData, parseAbi, type Address } from "viem";
import { isReclaimReview, sameReclaimHex, type ReclaimReview } from "../reclaim";

const redeemAbi = parseAbi(["function redeem(address,uint256[],uint256[],uint256[],bytes32[][],uint64,uint256,uint64,uint48) returns(uint64)"]);
export type ReclaimStoredTradeInV2 = readonly [Address, Address, number, bigint, bigint, number, number, number, Address];
export type ReclaimAcceptedEvidenceV2 = {
  receiptId: bigint; claimant: Address; collection: Address; standard: number;
  ids: readonly bigint[]; quantities: readonly bigint[]; reward: bigint; policyEpoch: bigint;
  claimantNonce: bigint; retirementMode: number; destination: Address;
};
export type ReclaimRetiredIdentityV2 = Pick<ReclaimAcceptedEvidenceV2,
  "receiptId" | "collection" | "standard" | "ids" | "quantities" | "retirementMode" | "destination">;
export type ReclaimRetirementEvidenceV2 = {
  accepted: ReclaimAcceptedEvidenceV2; retired: ReclaimRetiredIdentityV2;
  stored: ReclaimStoredTradeInV2; items: readonly [readonly bigint[], readonly bigint[]];
  standard: 1 | 2; retirementMode: 1 | 2; destination: Address;
  claimantNonceBefore: bigint; claimantNonceAfter: bigint;
  tradeInNonceBefore: bigint; tradeInNonceAfter: bigint;
};
const equal = (a: readonly bigint[], b: readonly bigint[]) => a.length === b.length && a.every((n, i) => n === b[i]);

/** Cross-bind independent event, storage and historical nonce reads. This does
 * not replace NFT/reward balance proof, canonical receipts or runtime checks. */
export function reclaimRetirementEvidenceMatches(review: ReclaimReview, evidence: ReclaimRetirementEvidenceV2): boolean {
  try {
    if (!isReclaimReview(review) || review.operation !== "redeem" || !review.nft) return false;
    const decoded = decodeFunctionData({ abi: redeemAbi, data: review.innerCall.data });
    if (decoded.functionName !== "redeem") return false;
    const [collection, ids, quantities, , , epoch, reward, nonce] = decoded.args;
    const { accepted: a, retired: p, stored: r, items, standard, retirementMode, destination } = evidence;
    const units = quantities.reduce((sum, quantity) => sum + quantity, 0n);
    return r.length === 9 && items.length === 2 && a.receiptId > 0n
      && evidence.tradeInNonceBefore + 1n === a.receiptId && evidence.tradeInNonceAfter === a.receiptId
      && evidence.claimantNonceBefore === nonce && evidence.claimantNonceAfter === nonce + 1n
      && a.claimantNonce === nonce && a.policyEpoch === epoch && a.reward === reward
      && sameReclaimHex(a.claimant, review.actor) && sameReclaimHex(a.collection, collection)
      && a.standard === standard && a.retirementMode === retirementMode && sameReclaimHex(a.destination, destination)
      && equal(a.ids, ids) && equal(a.quantities, quantities) && equal(items[0], ids) && equal(items[1], quantities)
      && sameReclaimHex(r[0], a.claimant) && sameReclaimHex(r[1], a.collection) && r[2] === a.standard
      && r[3] === a.policyEpoch && r[4] === a.reward && BigInt(r[5]) === units && r[6] === 1
      && r[7] === a.retirementMode && sameReclaimHex(r[8], a.destination)
      && p.receiptId === a.receiptId && sameReclaimHex(p.collection, a.collection) && p.standard === a.standard
      && p.retirementMode === a.retirementMode && sameReclaimHex(p.destination, a.destination)
      && equal(p.ids, a.ids) && equal(p.quantities, a.quantities)
      && review.nft.retirementMode === retirementMode && sameReclaimHex(review.nft.destination, destination);
  } catch { return false; }
}
