import type { Address, Hex } from "viem";
import { claimProfileDigest } from "./claim-profiles";
import { reclaimCalldataMatchesReview } from "./reclaim-calldata";
import {validReclaimAdministrationEvidence,type ReclaimAdministrationEvidence} from "./reclaim-administration";

export const reclaimProfile = "rmt-reclaim-v2-permanent";
export const reclaimReadPath = "/api/launchpad/reclaim";
export const reclaimTestPath = "/api/launchpad/test-reclaim";
export const reclaimFixtureFlag = "local-reviewed-reclaim-v2-permanent";
export const reclaimOperations = ["create-campaign", "approve-funding", "fund", "propose-collection", "execute-collection", "cancel-collection", "disable-collection",
  "approve-721", "approve-1155", "revoke-1155", "redeem", "pause", "resume", "propose-rate", "execute-rate", "cancel-rate",
  "propose-close", "execute-close", "cancel-close", "propose-recovery", "execute-recovery", "cancel-recovery", "propose-controller", "accept-controller", "cancel-controller"] as const;
export type ReclaimOperation = typeof reclaimOperations[number];
export type ReclaimFields = {
  intentId?: string; controller?: string; rewardPerUnit?: string; walletCap?: string; amountWei?: string;
  collection?: string; collectionCap?: string; collectionWalletCap?: string; expiresAt?: string;
  tokenId?: string; tokenIds?: string[]; quantities?: string[]; next?: string; permanentConsent?: true;
};
const fieldKeys: Record<ReclaimOperation, readonly (keyof ReclaimFields)[]> = {
  "create-campaign": ["intentId", "controller", "rewardPerUnit", "walletCap"], "approve-funding": ["amountWei"], fund: ["amountWei"],
  "propose-collection": ["collection", "collectionCap", "collectionWalletCap", "expiresAt"], "execute-collection": [], "cancel-collection": [], "disable-collection": ["collection"],
  "approve-721": ["collection", "tokenId"], "approve-1155": ["collection"], "revoke-1155": ["collection"], redeem: ["collection", "tokenIds", "quantities", "permanentConsent"],
  pause: [], resume: [], "propose-rate": ["rewardPerUnit", "expiresAt"], "execute-rate": [], "cancel-rate": [], "propose-close": ["expiresAt"], "execute-close": [], "cancel-close": [],
  "propose-recovery": ["amountWei", "expiresAt"], "execute-recovery": [], "cancel-recovery": [], "propose-controller": ["next", "expiresAt"], "accept-controller": [], "cancel-controller": [],
};
export const reclaimAddress = (value: unknown): value is Address => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value) && BigInt(value) > 0xffffn;
export const reclaimHash = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value) && BigInt(value) > 0n;
export const reclaimUint = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const quantity = (value: unknown): value is Hex => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value);
export const sameReclaimHex = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export type ReclaimPoint = { blockNumber: string; blockHash: Hex; timestamp: string };
const point = (value: ReclaimPoint) => value && /^[1-9][0-9]{0,15}$/.test(value.blockNumber) && reclaimHash(value.blockHash) && Number.isFinite(Date.parse(value.timestamp));
export function validReclaimFields(operation: ReclaimOperation, fields: unknown): fields is ReclaimFields {
  try {
    if (!reclaimOperations.includes(operation) || !fields || typeof fields !== "object" || Array.isArray(fields)) return false;
    const value = fields as ReclaimFields, keys = Object.keys(value), expected = fieldKeys[operation];
    if (keys.length !== expected.length || !expected.every(key => Object.hasOwn(value, key))) return false;
    for (const key of expected) {
      const item = value[key];
      if (key === "permanentConsent") { if (item !== true) return false; }
      else if (["controller", "collection", "next"].includes(key)) { if (!reclaimAddress(item)) return false; }
      else if (key === "intentId") { if (!reclaimHash(item)) return false; }
      else if (key === "tokenIds" || key === "quantities") { if (!Array.isArray(item) || item.length < 1 || item.length > 8 || !item.every(reclaimUint)) return false; }
      else if (!reclaimUint(item)) return false;
    }
    if (operation === "create-campaign" && (BigInt(value.rewardPerUnit!) < 1n || BigInt(value.rewardPerUnit!) >= 2n ** 128n || BigInt(value.walletCap!) < 1n || BigInt(value.walletCap!) >= 2n ** 32n)) return false;
    if (operation === "propose-collection" && ([value.collectionCap, value.collectionWalletCap].some(item => BigInt(item!) < 1n || BigInt(item!) >= 2n ** 32n))) return false;
    if (operation === "propose-rate" && (BigInt(value.rewardPerUnit!) < 1n || BigInt(value.rewardPerUnit!) >= 2n ** 128n)) return false;
    if (["approve-funding", "fund", "propose-recovery"].includes(operation) && BigInt(value.amountWei!) === 0n) return false;
    if (operation === "redeem") {
      if (value.tokenIds!.length !== value.quantities!.length || value.quantities!.some(item => BigInt(item) === 0n)
        || value.quantities!.reduce((total, item) => total + BigInt(item), 0n) > 20n) return false;
      for (let i = 1; i < value.tokenIds!.length; i++) if (BigInt(value.tokenIds![i - 1]) >= BigInt(value.tokenIds![i])) return false;
    }
    return true;
  } catch { return false; }
}
export function reclaimFieldsDigest(operation: ReclaimOperation, fields: ReclaimFields): Hex {
  if (!validReclaimFields(operation, fields)) throw Error("Invalid normalized Reclaim fields.");
  const normalized = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key,
    ["controller", "collection", "next", "intentId"].includes(key) && typeof value === "string" ? value.toLowerCase() : value]));
  return claimProfileDigest({ operation, fields: normalized });
}
export type ReclaimEligibleItem = { tokenId: string; maxQuantity: string; remainingQuantity: string; ownedQuantity?: string };
export type ReclaimCollection = { address: Address; standard: 1 | 2; runtimeHash: Hex; eligibilityRoot: Hex; enabled: boolean; admission: "candidate" | "admitted" | "disabled" | "unsupported";
  retirementMode: 1 | 2; destination: Address; policyHash: Hex;
  collectionCap: string; walletCap: string; acceptedUnits: string; eligibleItems: ReclaimEligibleItem[] };
export type ReclaimReceipt = { id: string; claimant: Address; collection: Address; standard: 1 | 2; tokenIds: string[]; quantities: string[];
  rewardWei: string; retirementMode: 1 | 2; destination: Address; policyHash: Hex; transactionHash: Hex; canonical: ReclaimPoint };
export type ReclaimNotice = { kind: "collection" | "rate" | "close" | "recovery" | "controller"; readyAt: string; expiresAt: string; epoch: string; detail: string };
export type ReclaimSnapshot = {
  status: "ready"; schemaVersion: 2; profile: typeof reclaimProfile; chainId: 31337; scope: "isolated-local"; executionEnabled: false;
  factory: Address; factoryRuntimeHash: Hex; campaign: Address; runtimeHash: Hex; creator: Address; controller: Address;
  controllerEpoch: string; policyEpoch: string; controllerKind: "eoa" | "metamask-7702" | "safe-1.4.1" | "unsupported";
  rewardToken: Address; rewardRuntimeHash: Hex; rewardDecimals: 18; rewardSymbol: string; rewardMode: "fixed-token-units";
  rewardPerUnit: string; walletCap: string; paused: boolean; closed: boolean;
  reserve: { heldWei: string; availableWei: string; fundedWei: string; paidWei: string; recoveredWei: string; unsolicitedWei: string; liabilityWei: "0" };
  collections: ReclaimCollection[]; receipts: ReclaimReceipt[]; pending: ReclaimNotice[];
  history: { status: "ready" | "pending" | "unavailable"; indexed: boolean; checkpoint?: ReclaimPoint };
  observed: ReclaimPoint; notices: string[];
  administration?: ReclaimAdministrationEvidence;
};
export function isReclaimSnapshot(value: unknown): value is ReclaimSnapshot {
  try {
    const s = value as ReclaimSnapshot;
    if (!s || s.status !== "ready" || s.schemaVersion !== 2 || s.profile !== reclaimProfile || s.chainId !== 31337 || s.scope !== "isolated-local" || s.executionEnabled !== false
      || ![s.factory, s.campaign, s.creator, s.controller, s.rewardToken].every(reclaimAddress) || ![s.factoryRuntimeHash, s.runtimeHash, s.rewardRuntimeHash].every(reclaimHash)
      || ![s.controllerEpoch, s.policyEpoch, s.rewardPerUnit, s.walletCap].every(reclaimUint) || BigInt(s.rewardPerUnit) === 0n
      || s.rewardDecimals !== 18 || s.rewardMode !== "fixed-token-units" || typeof s.rewardSymbol !== "string" || s.rewardSymbol.length > 32
      || !["eoa", "metamask-7702", "safe-1.4.1", "unsupported"].includes(s.controllerKind) || typeof s.paused !== "boolean" || typeof s.closed !== "boolean" || !point(s.observed)
      || !s.reserve || !Object.values(s.reserve).every(reclaimUint) || s.reserve.liabilityWei !== "0"
      || BigInt(s.reserve.availableWei) > BigInt(s.reserve.heldWei)
      || Object.hasOwn(s.reserve, "repaidWei") || BigInt(s.reserve.fundedWei) + BigInt(s.reserve.unsolicitedWei) !== BigInt(s.reserve.availableWei) + BigInt(s.reserve.paidWei) + BigInt(s.reserve.recoveredWei)
      || !Array.isArray(s.collections) || s.collections.length > 16 || !Array.isArray(s.receipts) || s.receipts.length > 100
      || !Array.isArray(s.pending) || s.pending.length > 5 || !Array.isArray(s.notices) || s.notices.length > 16
      || !s.notices.every(item => typeof item === "string" && item.length <= 1000) || !["ready", "pending", "unavailable"].includes(s.history.status) || typeof s.history.indexed !== "boolean") return false;
    if (s.history.checkpoint && !point(s.history.checkpoint)) return false;
    if(s.administration&&(!validReclaimAdministrationEvidence(s.administration)||s.administration.controller&&(!sameReclaimHex(s.administration.controller.address,s.controller)
      ||s.administration.controller.kind!==s.controllerKind)))return false;
    if (new Set(s.collections.map(item => item.address.toLowerCase())).size !== s.collections.length) return false;
    for (const c of s.collections) {
      if (!reclaimAddress(c.address) || !reclaimHash(c.runtimeHash) || !reclaimHash(c.eligibilityRoot) || ![1, 2].includes(c.standard) || typeof c.enabled !== "boolean"
        || !validRetirement(c) || !["candidate", "admitted", "disabled", "unsupported"].includes(c.admission)
        || ["candidate", "unsupported"].includes(c.admission) && (c.enabled || c.eligibleItems.length !== 0)
        || ![c.collectionCap, c.walletCap, c.acceptedUnits].every(reclaimUint) || !Array.isArray(c.eligibleItems) || c.eligibleItems.length > 16
        || new Set(c.eligibleItems.map(item => item.tokenId)).size !== c.eligibleItems.length || c.eligibleItems.some(item => ![item.tokenId, item.maxQuantity, item.remainingQuantity].every(reclaimUint)
          || BigInt(item.remainingQuantity) > BigInt(item.maxQuantity) || item.ownedQuantity !== undefined && !reclaimUint(item.ownedQuantity))) return false;
    }
    for (const receipt of s.receipts) if (!reclaimUint(receipt.id) || !reclaimAddress(receipt.claimant) || !reclaimAddress(receipt.collection) || ![1, 2].includes(receipt.standard)
      || !Array.isArray(receipt.tokenIds) || receipt.tokenIds.length < 1 || receipt.tokenIds.length > 8 || receipt.tokenIds.length !== receipt.quantities.length
      || !receipt.tokenIds.every(reclaimUint) || !receipt.quantities.every(item => reclaimUint(item) && BigInt(item) > 0n)
      || !reclaimUint(receipt.rewardWei) || !validRetirement(receipt) || Object.hasOwn(receipt, "returned") || !reclaimHash(receipt.transactionHash) || !point(receipt.canonical)) return false;
    return true;
  } catch { return false; }
}
export type ReclaimTransaction = { type: "0x2"; chainId: "0x7a69"; from: Address; to: Address; value: "0x0"; data: Hex;
  nonce: Hex; gas: Hex; maxFeePerGas: Hex; maxPriorityFeePerGas: Hex };
export type ReclaimWalletRequest = ReclaimTransaction;
export type ReclaimNftContext = { collection: Address; tokenIds: string[]; quantities: string[]; retirementMode: 1 | 2; destination: Address; policyHash: Hex };
const zero = "0x0000000000000000000000000000000000000000";
export const validRetirement = (value: { retirementMode: unknown; destination: unknown; policyHash: unknown }) => !!value
  && (value.retirementMode === 1 || value.retirementMode === 2) && reclaimHash(value.policyHash)
  && (value.retirementMode === 1 ? value.destination === zero : reclaimAddress(value.destination));
const nftContext = (value: ReclaimNftContext) => !!value && reclaimAddress(value.collection) && Array.isArray(value.tokenIds) && value.tokenIds.length > 0
  && value.tokenIds.length <= 8 && Array.isArray(value.quantities) && value.tokenIds.length === value.quantities.length
  && value.tokenIds.every(reclaimUint) && value.quantities.every(item => reclaimUint(item) && BigInt(item) > 0n)
  && value.quantities.reduce((total, item) => total + BigInt(item), 0n) <= 20n && value.tokenIds.every((id, index) => index === 0 || BigInt(value.tokenIds[index - 1]) < BigInt(id))
  && validRetirement(value);
export type ReclaimReview = {
  status: "prepared" | "needs-safe-approvals"; schemaVersion: 2; profile: typeof reclaimProfile; chainId: 31337; scope: "isolated-local"; executionEnabled: false;
  operation: ReclaimOperation; actor: Address; controller: Address; kind: "eoa" | "metamask-7702" | "safe-inner"; campaign: Address; factory: Address;
  rewardToken: Address; factoryRuntimeHash: Hex; campaignRuntimeHash: Hex; rewardRuntimeHash: Hex; targetRuntimeHash: Hex; actorCodeHash: Hex;
  controllerEpoch: string; policyEpoch: string; fields: ReclaimFields; request: ReclaimTransaction | null;
  innerCall: { from: Address; to: Address; data: Hex; value: "0x0" }; observed: ReclaimPoint; expiresAt: number; maximumNetworkFeeWei: string;
  rewardWei: string; custody: "permanent-retirement"; nft?: ReclaimNftContext;
  transfer?: { asset: Address; from: Address; to: Address; amountWei: string }; notices: string[]; reviewHash: Hex;
};
export function reclaimReviewHash(review: ReclaimReview | Omit<ReclaimReview, "reviewHash">): Hex {
  const { reviewHash: _ignored, ...body } = review as ReclaimReview; return claimProfileDigest(body);
}
export function isReclaimReview(value: unknown): value is ReclaimReview {
  try {
    const r = value as ReclaimReview;
    if (!r || r.schemaVersion !== 2 || r.profile !== reclaimProfile || r.chainId !== 31337 || r.scope !== "isolated-local" || r.executionEnabled !== false
      || !["prepared", "needs-safe-approvals"].includes(r.status) || !["eoa", "metamask-7702", "safe-inner"].includes(r.kind)
      || ![r.actor, r.controller, r.campaign, r.factory, r.rewardToken].every(reclaimAddress)
      || ![r.factoryRuntimeHash, r.campaignRuntimeHash, r.rewardRuntimeHash, r.targetRuntimeHash, r.actorCodeHash, r.reviewHash].every(reclaimHash)
      || ![r.controllerEpoch, r.policyEpoch, r.maximumNetworkFeeWei, r.rewardWei].every(reclaimUint) || !validReclaimFields(r.operation, r.fields)
      || r.custody !== "permanent-retirement" || !point(r.observed) || !Number.isSafeInteger(r.expiresAt) || r.expiresAt < 1
      || !Array.isArray(r.notices) || r.notices.length > 16 || !r.notices.every(item => typeof item === "string" && item.length <= 1000)
      || !r.innerCall || !sameReclaimHex(r.innerCall.from, r.actor) || !reclaimAddress(r.innerCall.to) || r.innerCall.value !== "0x0"
      || typeof r.innerCall.data !== "string" || !/^0x(?:[0-9a-f]{2}){4,65536}$/i.test(r.innerCall.data)
      || reclaimReviewHash(r) !== r.reviewHash || !reclaimCalldataMatchesReview(r)) return false;
    if (r.operation === "redeem" && (!r.nft || !nftContext(r.nft))) return false;
    const transfers = ["fund", "redeem", "execute-recovery"].includes(r.operation);
    if (transfers && !r.transfer) return false;
    if (r.transfer) {
      const t = r.transfer;
      if (!transfers || ![t.asset, t.from, t.to].every(reclaimAddress) || !sameReclaimHex(t.asset, r.rewardToken) || !reclaimUint(t.amountWei)
        || t.amountWei !== r.rewardWei || BigInt(t.amountWei) === 0n) return false;
      const inbound = r.operation === "fund";
      if (!sameReclaimHex(t.from, inbound ? r.actor : r.campaign)
        || !sameReclaimHex(t.to, inbound ? r.campaign : r.operation === "execute-recovery" ? r.controller : r.actor)) return false;
      if (r.operation === "fund" && t.amountWei !== r.fields.amountWei) return false;
    }
    if (r.nft && (r.operation !== "redeem" || !nftContext(r.nft) || !sameReclaimHex(r.nft.collection, r.fields.collection!)
      || JSON.stringify(r.nft.tokenIds) !== JSON.stringify(r.fields.tokenIds) || JSON.stringify(r.nft.quantities) !== JSON.stringify(r.fields.quantities))) return false;
    const nftApproval = ["approve-721", "approve-1155", "revoke-1155"].includes(r.operation);
    const expectedTarget = r.operation === "create-campaign" ? r.factory : r.operation === "approve-funding"
      ? r.rewardToken : nftApproval ? r.fields.collection : r.campaign;
    if (!expectedTarget || !sameReclaimHex(r.innerCall.to, expectedTarget)) return false;
    if (!nftApproval && r.targetRuntimeHash !== (r.operation === "create-campaign" ? r.factoryRuntimeHash
      : r.operation === "approve-funding" ? r.rewardRuntimeHash : r.campaignRuntimeHash)) return false;
    if (r.status === "needs-safe-approvals") return r.kind === "safe-inner" && r.request === null && r.maximumNetworkFeeWei === "0";
    const tx = r.request;
    return r.kind !== "safe-inner" && !!tx && Object.keys(tx).length === 10 && tx.type === "0x2" && tx.chainId === "0x7a69" && tx.value === "0x0"
      && sameReclaimHex(tx.from, r.actor) && sameReclaimHex(tx.to, r.innerCall.to) && sameReclaimHex(tx.data, r.innerCall.data)
      && [tx.nonce, tx.gas, tx.maxFeePerGas, tx.maxPriorityFeePerGas].every(quantity) && BigInt(tx.gas) > 0n
      && BigInt(tx.maxPriorityFeePerGas) <= BigInt(tx.maxFeePerGas) && BigInt(tx.gas) * BigInt(tx.maxFeePerGas) === BigInt(r.maximumNetworkFeeWei);
  } catch { return false; }
}
export type ReclaimVerification = { schemaVersion: 2; profile: typeof reclaimProfile; chainId: 31337; executionEnabled: false;
  status: "pending" | "confirmed" | "reverted" | "unavailable" | "reorged"; finality: "synthetic-local-not-production";
  reviewHash: Hex; transactionHash?: Hex; canonical?: ReclaimPoint; indexed?: boolean; snapshot?: ReclaimSnapshot; reason?: string;
  settlement?: ReclaimNftContext & { kind: "permanent-surrender"; receiptId: string; claimant: Address; rewardToken: Address; rewardWei: string;
    custody: "permanent-retirement"; transactionHash: Hex; canonical: ReclaimPoint } };
export function reclaimVerificationMatches(review: ReclaimReview, value: unknown, knownHash?: string): value is ReclaimVerification {
  try {
    const r = value as ReclaimVerification;
    if (!r || r.schemaVersion !== 2 || r.profile !== reclaimProfile || r.chainId !== 31337 || r.executionEnabled !== false || r.finality !== "synthetic-local-not-production"
      || !["pending", "confirmed", "reverted", "unavailable", "reorged"].includes(r.status) || r.reviewHash !== review.reviewHash
      || r.indexed !== undefined && typeof r.indexed !== "boolean" || r.reason !== undefined && (typeof r.reason !== "string" || r.reason.length > 1000)
      || r.transactionHash !== undefined && (!reclaimHash(r.transactionHash) || !!knownHash && !sameReclaimHex(r.transactionHash, knownHash))) return false;
    if (r.canonical !== undefined && !point(r.canonical)) return false;
    if (["confirmed", "reverted"].includes(r.status) && (!r.transactionHash || !r.canonical || !point(r.canonical)
      || BigInt(r.canonical.blockNumber) <= BigInt(review.observed.blockNumber))) return false;
    if (r.snapshot && (!isReclaimSnapshot(r.snapshot) || !sameReclaimHex(r.snapshot.campaign, review.campaign) || !sameReclaimHex(r.snapshot.factory, review.factory)
      || !sameReclaimHex(r.snapshot.rewardToken, review.rewardToken) || !sameReclaimHex(r.snapshot.rewardRuntimeHash, review.rewardRuntimeHash)
      || !sameReclaimHex(r.snapshot.runtimeHash, review.campaignRuntimeHash) || !sameReclaimHex(r.snapshot.factoryRuntimeHash, review.factoryRuntimeHash))) return false;
    if (r.status === "confirmed" && review.operation === "redeem") {
      const s = r.settlement, nft = review.nft;
      if (!s || !nft || !nftContext(s) || !reclaimUint(s.receiptId) || !reclaimAddress(s.claimant) || !sameReclaimHex(s.claimant, review.actor)
        || !sameReclaimHex(s.collection, nft.collection) || !sameReclaimHex(s.rewardToken, review.rewardToken) || s.rewardWei !== review.rewardWei
        || JSON.stringify(s.tokenIds) !== JSON.stringify(nft.tokenIds) || JSON.stringify(s.quantities) !== JSON.stringify(nft.quantities)
        || !sameReclaimHex(s.transactionHash, r.transactionHash!) || !point(s.canonical) || s.canonical.blockNumber !== r.canonical!.blockNumber
        || !sameReclaimHex(s.canonical.blockHash, r.canonical!.blockHash) || s.canonical.timestamp !== r.canonical!.timestamp
        || s.kind !== "permanent-surrender" || s.custody !== "permanent-retirement" || s.retirementMode !== nft.retirementMode
        || !sameReclaimHex(s.destination, nft.destination) || !sameReclaimHex(s.policyHash, nft.policyHash)) return false;
    }
    return true;
  } catch { return false; }
}
