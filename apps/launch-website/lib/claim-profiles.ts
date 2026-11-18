import { encodeFunctionData, keccak256, parseAbi, stringToHex, zeroAddress, type Address, type Hex } from "viem";
import { isEarningsClaimRequest, type EarningsClaimRequest } from "./earnings-claims";

export const claimExecutionProfile = "rmt-claim-execution-v1";
export const claimDelegatePin = Object.freeze({ address: "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B" as Address,
  designator: "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b" as Hex,
  runtimeHash: "0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0" as Hex });
export type ClaimWalletKind = "eoa" | "metamask-7702" | "safe-1.4.1";
export type ClaimOuterTransaction = {
  type: "0x2"; chainId: "0x7a69" | "0x1237"; from: Address; to: Address; value: "0x0"; data: Hex; nonce: Hex;
  gas?: Hex; maxFeePerGas?: Hex; maxPriorityFeePerGas?: Hex;
};
export type ClaimSafeTransaction = {
  to: Address; value: "0"; data: Hex; operation: 0; safeTxGas: "0"; baseGas: "0"; gasPrice: "0";
  gasToken: Address; refundReceiver: Address; nonce: string;
};
export type ClaimWalletEvidence = {
  kind: ClaimWalletKind; actorCodeHash: Hex; actorNonce: string;
  delegation: null | { address: Address; designator: Hex; runtimeHash: Hex };
  safe: null | {
    address: Address; version: "1.4.1"; singleton: Address; singletonRuntimeHash: Hex; proxyRuntimeHash: Hex;
    fallbackHandler: Address; fallbackRuntimeHash: Hex; owners: Address[]; threshold: 2; nonce: string; evmNonce: string;
    transaction: ClaimSafeTransaction; transactionHash: Hex; signatures: Hex | null; approvalsCollected: 0 | 2;
    expiryEnforcement: "safe-nonce-only" | "inner-contract-deadline";
  };
};
export type ClaimFeeEvidence = { status: "verified-nitro" | "synthetic-local"; gasUnits: string; gasLimit: string;
  l2GasUnits: string; l1PosterGasUnits: string; baseFeeWei: string; l1BaseFeeWei: string;
  estimatedL2Wei: string; estimatedL1Wei: string; estimatedTotalWei: string;
  maxFeePerGasWei: string; maxPriorityFeePerGasWei: string; proposedMaximumWei: string;
  observedBlockNumber: string; observedBlockHash: Hex; includesL1Data: boolean;
} | { status: "unavailable"; reason: string };

/** An auditable unsigned review, never permission to sign or broadcast. For a
 * Safe, inner.nonce is the explicitly identified Safe nonce, while outer.nonce
 * is the external gas payer's EVM nonce. The Safe EVM nonce is separate again. */
export type ClaimExecutionReview = {
  schemaVersion: 1; profile: typeof claimExecutionProfile; chainId: 31337 | 4663; scope: "isolated-local" | "production-unsigned";
  status: "review-only" | "awaiting-safe-approvals" | "fee-unavailable"; executionEnabled: false;
  kind: ClaimWalletKind; actor: Address; beneficiary: Address; gasPayer: Address;
  inner: EarningsClaimRequest; outer: ClaimOuterTransaction | null; wallet: ClaimWalletEvidence; fees: ClaimFeeEvidence;
  gasPayerEvidence: { codeHash: Hex; kind: "eoa" | "metamask-7702"; nonce: string };
  authorizations: { ownerApprovalsRequired: 0 | 2; ownerApprovalsCollected: 0 | 2; walletTransactionConfirmations: 1 };
  observed: { blockNumber: string; blockHash: Hex; timestamp: string }; expiresAt: number;
  holds: string[]; notices: string[]; intentHash: Hex; reviewHash: Hex;
};
const hash = (x: unknown): x is Hex => typeof x === "string" && /^0x[0-9a-f]{64}$/i.test(x);
const address = (x: unknown): x is Address => typeof x === "string" && /^0x[0-9a-f]{40}$/i.test(x) && BigInt(x) > 0xffffn;
const decimal = (x: unknown): x is string => typeof x === "string" && /^(0|[1-9][0-9]{0,77})$/.test(x) && BigInt(x) < 2n ** 256n;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const shape = (value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
  && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const quantity = (v: unknown): v is Hex => typeof v === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(v);
const safeExecAbi = parseAbi(["function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool)"]);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export const claimProfileDigest = (value: unknown): Hex => keccak256(stringToHex(JSON.stringify(canonical(value))));
export function claimExecutionIdentity(review: Omit<ClaimExecutionReview, "intentHash" | "reviewHash"> | ClaimExecutionReview): Hex {
  return claimProfileDigest({ profile: review.profile, chainId: review.chainId, kind: review.kind, actor: review.actor,
    beneficiary: review.beneficiary, gasPayer: review.gasPayer, inner: review.inner,
    payerNonce: review.gasPayerEvidence.nonce, safeTransactionHash: review.wallet.safe?.transactionHash ?? null });
}
export function claimExecutionReviewHash(review: Omit<ClaimExecutionReview, "reviewHash"> | ClaimExecutionReview): Hex {
  const { reviewHash: _ignored, ...body } = review as ClaimExecutionReview;
  return claimProfileDigest(body);
}
export function isClaimExecutionReview(value: unknown): value is ClaimExecutionReview {
  try {
    const r = value as ClaimExecutionReview;
    if (!shape(r, ["schemaVersion", "profile", "chainId", "scope", "status", "executionEnabled", "kind", "actor", "beneficiary", "gasPayer", "inner", "outer", "wallet", "fees", "gasPayerEvidence", "authorizations", "observed", "expiresAt", "holds", "notices", "intentHash", "reviewHash"])
      || !shape(r.wallet, ["kind", "actorCodeHash", "actorNonce", "delegation", "safe"])
      || !shape(r.gasPayerEvidence, ["codeHash", "kind", "nonce"]) || !shape(r.authorizations, ["ownerApprovalsRequired", "ownerApprovalsCollected", "walletTransactionConfirmations"])
      || !shape(r.observed, ["blockNumber", "blockHash", "timestamp"])
      || r.schemaVersion !== 1 || r.profile !== claimExecutionProfile || ![31337, 4663].includes(r.chainId)
      || r.scope !== (r.chainId === 31337 ? "isolated-local" : "production-unsigned") || r.executionEnabled !== false
      || !["review-only", "awaiting-safe-approvals", "fee-unavailable"].includes(r.status)
      || !["eoa", "metamask-7702", "safe-1.4.1"].includes(r.kind)
      || ![r.actor, r.beneficiary, r.gasPayer].every(address) || !isEarningsClaimRequest(r.inner)
      || r.inner.chainId !== (r.chainId === 31337 ? "0x7a69" : "0x1237") || !same(r.inner.from, r.actor)
      || !same(r.inner.beneficiary, r.beneficiary) || r.wallet.kind !== r.kind || !hash(r.wallet.actorCodeHash)
      || !decimal(r.wallet.actorNonce) || !decimal(r.gasPayerEvidence.nonce) || !hash(r.gasPayerEvidence.codeHash)
      || !["eoa", "metamask-7702"].includes(r.gasPayerEvidence.kind)
      || !decimal(r.observed.blockNumber) || !hash(r.observed.blockHash) || !Number.isFinite(Date.parse(r.observed.timestamp))
      || !Number.isSafeInteger(r.expiresAt) || r.expiresAt !== r.inner.reviewExpiresAt
      || r.authorizations.walletTransactionConfirmations !== 1 || !Array.isArray(r.holds) || r.holds.length > 16
      || !Array.isArray(r.notices) || r.notices.length > 16 || [...r.holds, ...r.notices].some(v => typeof v !== "string" || v.length > 1024)
      || !hash(r.intentHash) || !hash(r.reviewHash) || claimExecutionIdentity(r) !== r.intentHash || claimExecutionReviewHash(r) !== r.reviewHash) return false;
    const safe = r.wallet.safe;
    if (r.wallet.delegation !== null && (!shape(r.wallet.delegation, ["address", "designator", "runtimeHash"])
      || !address(r.wallet.delegation.address) || !hash(r.wallet.delegation.runtimeHash) || !/^0xef0100[0-9a-f]{40}$/i.test(r.wallet.delegation.designator)
      || !same(r.wallet.delegation.address, claimDelegatePin.address) || !same(r.wallet.delegation.designator, claimDelegatePin.designator)
      || !same(r.wallet.delegation.runtimeHash, claimDelegatePin.runtimeHash))) return false;
    if ((r.kind === "metamask-7702") !== (r.wallet.delegation !== null)) return false;
    if (r.kind === "safe-1.4.1") {
      if (!safe || !shape(safe, ["address", "version", "singleton", "singletonRuntimeHash", "proxyRuntimeHash", "fallbackHandler", "fallbackRuntimeHash", "owners", "threshold", "nonce", "evmNonce", "transaction", "transactionHash", "signatures", "approvalsCollected", "expiryEnforcement"])
        || !shape(safe.transaction, ["to", "value", "data", "operation", "safeTxGas", "baseGas", "gasPrice", "gasToken", "refundReceiver", "nonce"])
        || ![safe.singleton, safe.fallbackHandler].every(address) || ![safe.singletonRuntimeHash, safe.proxyRuntimeHash, safe.fallbackRuntimeHash].every(hash)
        || safe.expiryEnforcement !== (r.inner.deadline ? "inner-contract-deadline" : "safe-nonce-only")
        || !same(safe.address, r.actor) || safe.version !== "1.4.1" || safe.threshold !== 2 || safe.owners.length !== 3
        || !safe.owners.every(address) || new Set(safe.owners.map(v => v.toLowerCase())).size !== 3
        || !decimal(safe.nonce) || !decimal(safe.evmNonce) || safe.evmNonce !== r.wallet.actorNonce || !hash(safe.transactionHash)
        || !same(safe.transaction.to, r.inner.to) || safe.transaction.data !== r.inner.data || safe.transaction.value !== "0"
        || safe.transaction.operation !== 0 || safe.transaction.safeTxGas !== "0" || safe.transaction.baseGas !== "0"
        || safe.transaction.gasPrice !== "0" || !/^0x0{40}$/i.test(safe.transaction.gasToken) || !/^0x0{40}$/i.test(safe.transaction.refundReceiver)
        || safe.transaction.nonce !== safe.nonce || BigInt(r.inner.nonce) !== BigInt(safe.nonce)
        || r.authorizations.ownerApprovalsRequired !== 2 || r.authorizations.ownerApprovalsCollected !== safe.approvalsCollected
        || ![0, 2].includes(safe.approvalsCollected) || (safe.approvalsCollected === 0 ? safe.signatures !== null || r.outer !== null
          : !safe.signatures || !/^0x[0-9a-f]{260}$/i.test(safe.signatures))) return false;
    } else if (safe !== null || r.authorizations.ownerApprovalsRequired !== 0 || r.authorizations.ownerApprovalsCollected !== 0
      || !same(r.actor, r.gasPayer) || r.wallet.actorNonce !== r.gasPayerEvidence.nonce || BigInt(r.inner.nonce) !== BigInt(r.gasPayerEvidence.nonce)) return false;
    if (r.outer && (!shape(r.outer, ["type", "chainId", "from", "to", "value", "data", "nonce"], ["gas", "maxFeePerGas", "maxPriorityFeePerGas"])
      || r.outer.chainId !== r.inner.chainId || r.outer.type !== "0x2" || !same(r.outer.from, r.gasPayer)
      || !same(r.outer.to, safe ? safe.address : r.inner.to) || r.outer.value !== "0x0"
      || !quantity(r.outer.nonce) || BigInt(r.outer.nonce) !== BigInt(r.gasPayerEvidence.nonce)
      || !/^0x(?:[0-9a-f]{2}){1,16384}$/i.test(r.outer.data) || (!safe && r.outer.data !== r.inner.data))) return false;
    if (safe && r.outer && r.outer.data !== encodeFunctionData({ abi: safeExecAbi, functionName: "execTransaction", args: [safe.transaction.to, 0n, safe.transaction.data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, safe.signatures!] })) return false;
    if (r.fees.status === "unavailable") return shape(r.fees, ["status", "reason"]) && typeof r.fees.reason === "string" && r.fees.reason.length <= 1024
      && r.status === (safe?.approvalsCollected === 0 ? "awaiting-safe-approvals" : "fee-unavailable");
    if (!shape(r.fees, ["status", "gasUnits", "gasLimit", "l2GasUnits", "l1PosterGasUnits", "baseFeeWei", "l1BaseFeeWei", "estimatedL2Wei", "estimatedL1Wei", "estimatedTotalWei", "maxFeePerGasWei", "maxPriorityFeePerGasWei", "proposedMaximumWei", "observedBlockNumber", "observedBlockHash", "includesL1Data"])) return false;
    if (!["verified-nitro", "synthetic-local"].includes(r.fees.status) || (r.chainId === 4663) !== (r.fees.status === "verified-nitro")
      || r.fees.includesL1Data !== (r.chainId === 4663) || ![r.fees.gasUnits, r.fees.gasLimit, r.fees.l2GasUnits, r.fees.l1PosterGasUnits,
        r.fees.baseFeeWei, r.fees.l1BaseFeeWei, r.fees.estimatedL2Wei, r.fees.estimatedL1Wei, r.fees.estimatedTotalWei,
        r.fees.maxFeePerGasWei, r.fees.maxPriorityFeePerGasWei, r.fees.proposedMaximumWei].every(decimal)
      || BigInt(r.fees.gasUnits) !== BigInt(r.fees.l2GasUnits) + BigInt(r.fees.l1PosterGasUnits)
      || BigInt(r.fees.gasUnits) < 21000n || BigInt(r.fees.gasUnits) > 30_000_000n || BigInt(r.fees.gasLimit) < BigInt(r.fees.gasUnits)
      || BigInt(r.fees.gasLimit) > 30_000_000n || BigInt(r.fees.baseFeeWei) <= 0n || BigInt(r.fees.maxFeePerGasWei) <= 0n
      || BigInt(r.fees.maxPriorityFeePerGasWei) > BigInt(r.fees.maxFeePerGasWei)
      || (r.chainId === 4663 ? BigInt(r.fees.l1PosterGasUnits) <= 0n || BigInt(r.fees.l1PosterGasUnits) >= BigInt(r.fees.gasUnits) || BigInt(r.fees.l1BaseFeeWei) <= 0n
        : r.fees.l1PosterGasUnits !== "0" || r.fees.l1BaseFeeWei !== "0")
      || r.fees.observedBlockNumber !== r.observed.blockNumber || !same(r.fees.observedBlockHash, r.observed.blockHash)
      || BigInt(r.fees.estimatedL2Wei) !== BigInt(r.fees.l2GasUnits) * BigInt(r.fees.baseFeeWei)
      || BigInt(r.fees.estimatedL1Wei) !== BigInt(r.fees.l1PosterGasUnits) * BigInt(r.fees.baseFeeWei)
      || BigInt(r.fees.estimatedTotalWei) !== BigInt(r.fees.estimatedL2Wei) + BigInt(r.fees.estimatedL1Wei)
      || BigInt(r.fees.proposedMaximumWei) !== BigInt(r.fees.gasLimit) * BigInt(r.fees.maxFeePerGasWei)) return false;
    return r.status === "review-only" && r.outer !== null && quantity(r.outer.gas) && quantity(r.outer.maxFeePerGas) && quantity(r.outer.maxPriorityFeePerGas)
      && BigInt(r.outer.gas) === BigInt(r.fees.gasLimit) && BigInt(r.outer.maxFeePerGas) === BigInt(r.fees.maxFeePerGasWei)
      && BigInt(r.outer.maxPriorityFeePerGas) === BigInt(r.fees.maxPriorityFeePerGasWei);
  } catch { return false; }
}
