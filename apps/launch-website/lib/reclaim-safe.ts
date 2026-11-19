import { concatHex, decodeFunctionData, encodeFunctionData, hashTypedData, parseAbi, recoverTypedDataAddress, zeroAddress, type Address, type Hex } from "viem";
import { claimProfileDigest } from "./claim-profiles";
import { isReclaimReview, reclaimAddress, reclaimHash, reclaimProfile, reclaimUint, reclaimVerificationMatches, sameReclaimHex,
  type ReclaimPoint, type ReclaimReview, type ReclaimTransaction, type ReclaimVerification } from "./reclaim";

export type ReclaimSafeApproval = { signer: Address; signature: Hex };
export type ReclaimSafeTransaction = { to: Address; value: "0"; data: Hex; operation: 0; safeTxGas: "0"; baseGas: "0"; gasPrice: "0";
  gasToken: typeof zeroAddress; refundReceiver: typeof zeroAddress; nonce: string };
export type ReclaimSafeProposal = {
  schemaVersion: 1; profile: typeof reclaimProfile; chainId: 31337; scope: "isolated-local"; executionEnabled: false; status: "awaiting-safe-approvals";
  innerReview: ReclaimReview; safe: Address; gasPayer: Address; owners: Address[]; threshold: 2; safeNonce: string; gasPayerNonce: string;
  safeTx: ReclaimSafeTransaction; digest: Hex; observed: ReclaimPoint; expiresAt: number; proposalHash: Hex;
};
export type ReclaimSafeOuterReview = {
  schemaVersion: 1; profile: typeof reclaimProfile; chainId: 31337; scope: "isolated-local"; executionEnabled: false; status: "prepared";
  proposal: ReclaimSafeProposal; approvals: ReclaimSafeApproval[]; request: ReclaimTransaction; observed: ReclaimPoint; expiresAt: number;
  maximumNetworkFeeWei: string; gasPayerCodeHash: Hex; reviewHash: Hex;
};
export type ReclaimSafeVerification = Omit<ReclaimVerification, "reviewHash"> & {
  reviewHash: Hex; proposalHash: Hex; safe: Address; gasPayer: Address; safeNonce: string; operation: ReclaimReview["operation"];
};
const safeFields = [
  { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
  { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" },
  { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
] as const;
export const reclaimSafeExecutionAbi = parseAbi(["function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool)"]);
const point = (p: ReclaimPoint) => !!p && reclaimUint(p.blockNumber) && BigInt(p.blockNumber) > 0n && reclaimHash(p.blockHash) && Number.isFinite(Date.parse(p.timestamp));
const quantity = (v: unknown): v is Hex => typeof v === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(v);
const signature = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-f]{130}$/i.test(v) && [27, 28].includes(parseInt(v.slice(-2), 16))
  && BigInt("0x" + v.slice(2, 66)) > 0n && BigInt("0x" + v.slice(66, 130)) > 0n
  && BigInt("0x" + v.slice(66, 130)) <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
export function canonicalSafeTypedData(proposal: ReclaimSafeProposal) {
  return { domain: { chainId: 31337, verifyingContract: proposal.safe }, primaryType: "SafeTx" as const,
    types: { EIP712Domain: [{ name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], SafeTx: safeFields },
    message: proposal.safeTx };
}
export function reclaimSafeProposalHash(proposal: ReclaimSafeProposal | Omit<ReclaimSafeProposal, "proposalHash">): Hex {
  const { proposalHash: _ignored, ...value } = proposal as ReclaimSafeProposal; return claimProfileDigest(value);
}
export function reclaimSafeOuterReviewHash(review: ReclaimSafeOuterReview | Omit<ReclaimSafeOuterReview, "reviewHash">): Hex {
  const { reviewHash: _ignored, ...value } = review as ReclaimSafeOuterReview; return claimProfileDigest(value);
}
export function isReclaimSafeProposal(value: unknown): value is ReclaimSafeProposal {
  try {
    const p = value as ReclaimSafeProposal, r = p?.innerReview, tx = p?.safeTx;
    if (!p || p.schemaVersion !== 1 || p.profile !== reclaimProfile || p.chainId !== 31337 || p.scope !== "isolated-local" || p.executionEnabled !== false
      || p.status !== "awaiting-safe-approvals" || !isReclaimReview(r) || r.kind !== "safe-inner" || r.status !== "needs-safe-approvals" || r.request !== null
      || ![p.safe, p.gasPayer].every(reclaimAddress) || !sameReclaimHex(p.safe, r.actor) || sameReclaimHex(p.safe, p.gasPayer)
      || !Array.isArray(p.owners) || p.owners.length !== 3 || !p.owners.every(reclaimAddress) || new Set(p.owners.map(x => x.toLowerCase())).size !== 3
      || p.threshold !== 2 || ![p.safeNonce, p.gasPayerNonce].every(reclaimUint) || BigInt(p.gasPayerNonce) > BigInt(Number.MAX_SAFE_INTEGER)
      || !point(p.observed) || !Number.isSafeInteger(p.expiresAt) || p.expiresAt !== r.expiresAt || ![p.digest, p.proposalHash].every(reclaimHash)
      || !tx || Object.keys(tx).length !== 10 || typeof tx.data !== "string" || !/^0x(?:[0-9a-f]{2}){4,65536}$/i.test(tx.data)
      || !sameReclaimHex(tx.to, r.innerCall.to) || !sameReclaimHex(tx.data, r.innerCall.data) || tx.value !== "0" || tx.operation !== 0
      || tx.safeTxGas !== "0" || tx.baseGas !== "0" || tx.gasPrice !== "0" || tx.gasToken !== zeroAddress || tx.refundReceiver !== zeroAddress || tx.nonce !== p.safeNonce
      || reclaimSafeProposalHash(p) !== p.proposalHash) return false;
    return sameReclaimHex(hashTypedData(canonicalSafeTypedData(p) as never), p.digest);
  } catch { return false; }
}
export function canonicalSafeApprovals(approvals: readonly ReclaimSafeApproval[]): ReclaimSafeApproval[] {
  return [...approvals].sort((a, b) => BigInt(a.signer) < BigInt(b.signer) ? -1 : 1);
}
export function isReclaimSafeApproval(proposal: ReclaimSafeProposal, approval: unknown): approval is ReclaimSafeApproval {
  const a = approval as ReclaimSafeApproval;
  return !!a && Object.keys(a).length === 2 && reclaimAddress(a.signer) && signature(a.signature) && proposal.owners.some(owner => sameReclaimHex(owner, a.signer));
}
export async function verifyReclaimSafeApproval(proposal: ReclaimSafeProposal, approval: ReclaimSafeApproval): Promise<boolean> {
  try { return isReclaimSafeProposal(proposal) && isReclaimSafeApproval(proposal, approval)
    && sameReclaimHex(await recoverTypedDataAddress({ ...canonicalSafeTypedData(proposal), signature: approval.signature } as never), approval.signer); }
  catch { return false; }
}
export async function verifyReclaimSafeApprovals(proposal: ReclaimSafeProposal, approvals: readonly ReclaimSafeApproval[]): Promise<boolean> {
  try { return Array.isArray(approvals) && approvals.length === 2 && !sameReclaimHex(approvals[0].signer, approvals[1].signer)
    && (await Promise.all(approvals.map(approval => verifyReclaimSafeApproval(proposal, approval)))).every(Boolean); }
  catch { return false; }
}
export function isReclaimSafeOuterReview(value: unknown): value is ReclaimSafeOuterReview {
  try {
    const r = value as ReclaimSafeOuterReview, p = r?.proposal, tx = r?.request;
    if (!r || r.schemaVersion !== 1 || r.profile !== reclaimProfile || r.chainId !== 31337 || r.scope !== "isolated-local" || r.executionEnabled !== false || r.status !== "prepared"
      || !isReclaimSafeProposal(p) || !Array.isArray(r.approvals) || r.approvals.length !== 2 || !r.approvals.every(a => isReclaimSafeApproval(p, a))
      || sameReclaimHex(r.approvals[0].signer, r.approvals[1].signer) || JSON.stringify(canonicalSafeApprovals(r.approvals)) !== JSON.stringify(r.approvals)
      || !point(r.observed) || r.expiresAt !== p.expiresAt || !reclaimUint(r.maximumNetworkFeeWei) || !reclaimHash(r.gasPayerCodeHash) || !reclaimHash(r.reviewHash)
      || reclaimSafeOuterReviewHash(r) !== r.reviewHash || !tx || Object.keys(tx).length !== 10 || tx.type !== "0x2" || tx.chainId !== "0x7a69" || tx.value !== "0x0"
      || !sameReclaimHex(tx.from, p.gasPayer) || !sameReclaimHex(tx.to, p.safe) || ![tx.nonce, tx.gas, tx.maxFeePerGas, tx.maxPriorityFeePerGas].every(quantity)
      || BigInt(tx.nonce) !== BigInt(p.gasPayerNonce) || BigInt(tx.gas) <= 0n || BigInt(tx.gas) > 20_000_000n || BigInt(tx.maxFeePerGas) <= 0n || BigInt(tx.maxPriorityFeePerGas) > BigInt(tx.maxFeePerGas)
      || BigInt(tx.gas) * BigInt(tx.maxFeePerGas) !== BigInt(r.maximumNetworkFeeWei)) return false;
    const decoded = decodeFunctionData({ abi: reclaimSafeExecutionAbi, data: tx.data });
    const expected = [p.safeTx.to, 0n, p.safeTx.data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, concatHex(r.approvals.map(a => a.signature))] as const;
    return decoded.functionName === "execTransaction" && sameReclaimHex(encodeFunctionData({ abi: reclaimSafeExecutionAbi, functionName: "execTransaction", args: expected }), tx.data);
  } catch { return false; }
}
export function reclaimSafeVerificationMatches(review: ReclaimSafeOuterReview, value: unknown, knownHash?: string): value is ReclaimSafeVerification {
  try {
    const r = value as ReclaimSafeVerification, p = review.proposal;
    return !!r && r.reviewHash === review.reviewHash && r.proposalHash === p.proposalHash && sameReclaimHex(r.safe, p.safe) && sameReclaimHex(r.gasPayer, p.gasPayer)
      && r.safeNonce === p.safeNonce && r.operation === p.innerReview.operation
      && reclaimVerificationMatches(p.innerReview, { ...r, reviewHash: p.innerReview.reviewHash }, knownHash);
  } catch { return false; }
}
