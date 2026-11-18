import { claimProfileDigest } from "./claim-profiles";
import type { Address, Hex } from "viem";
import { isEarningsClaimRequest, type EarningsClaimRequest } from "./earnings-claims";

export const projectTreasuryProfile = "rmt-project-treasury-v1";
export const projectTreasuryReadPath = "/api/launchpad/project-treasury";
export const projectTreasuryTestPath = "/api/launchpad/test-project-treasury";
export const projectTreasuryFixtureFlag = "local-reviewed-project-treasury-v1";
export const projectTreasuryOperations = ["create-treasury", "bind-project", "claim-curve", "collect-lp", "claim-lp",
  "claim-lp-native", "claim-lp-token", "set-purchases", "schedule-controller", "cancel-controller", "accept-controller",
  "schedule-withdrawal", "cancel-withdrawal", "execute-withdrawal"] as const;
export type ProjectTreasuryOperation = typeof projectTreasuryOperations[number];
export type ProjectTreasuryPoint = { blockNumber: string; blockHash: Hex; timestamp: string };
export type ProjectTreasuryProof = {
  schemaVersion: 1; profile: typeof projectTreasuryProfile; chainId: 31337;
  creator: Address; controller: Address; intentId: Hex; treasuryShareBps: number;
  treasury: Address; treasuryFactory: Address; coreFactory: Address;
  factoryRuntimeHash: Hex; runtimeHash: Hex;
  deployment: ProjectTreasuryPoint & { transactionHash: Hex; logIndex: number };
};
export type ProjectTreasuryAsset = {
  address: Address | null; symbol: string; heldWei: string; availableWei: string; unclassifiedWei: string;
  manualWei: string; declaredFundingWei: string; unsolicitedWei: string; feesReceivedWei: string; purchasedWei: string; withdrawnWei: string;
  reservedWei: string; support: "native" | "reviewed-standard" | "unsupported";
};
export type ProjectTreasuryEvent = {
  event: string; blockNumber: string; blockHash: Hex; transactionHash: Hex; logIndex: number;
  timestamp: string; asset?: Address; amountWei?: string; source?: string;
};
export type ProjectTreasuryRules = {
  perTransactionWei: string; perPeriodWei: string; minimumWei: string; cooldownSeconds: string;
  periodSeconds: string; maxSlippageBps: number; maxImpactBps: number; lastPurchaseAt: string;
};
export type ProjectTreasurySnapshot = {
  status: "ready"; schemaVersion: 1; profile: typeof projectTreasuryProfile; chainId: 31337;
  scope: "isolated-local"; executionEnabled: false; proof: ProjectTreasuryProof;
  treasury: Address; creator: Address; controller: Address; controllerEpoch: string; intentId: Hex;
  treasuryShareBps: number; controllerKind: "eoa" | "metamask-7702" | "safe-1.4.1" | "unsupported";
  project: { status: "unbound" | "verified-unbound" | "bound"; token: Address | null; originalCurve: Address | null;
    activeCurve: Address | null; curveLedger: Address | null; lpLedger: Address | null; graduated: boolean };
  assets: ProjectTreasuryAsset[];
  earnings: { status: "ready" | "unavailable" | "not-bound"; curveNativeWei: string | null; lpNativeWei: string | null; lpTokenWei: string | null };
  purchases: { enabled: boolean; available: boolean; reason: string; rules: ProjectTreasuryRules; pendingAuthorization: "none" | "controller-review-required" };
  rotation: null | { incoming: Address; readyAt: string; expiresAt: string; epoch: string };
  withdrawals: Array<{ id: Hex; asset: Address; recipient: Address; amountWei: string; readyAt: string; expiresAt: string; epoch: string }>;
  events: ProjectTreasuryEvent[]; history: { indexed: boolean; status: "ready" | "pending" | "unavailable"; checkpoint?: ProjectTreasuryPoint };
  observed: ProjectTreasuryPoint; notices: string[];
};
export type ProjectTreasuryPreview = {
  status: "preview"; schemaVersion: 1; profile: typeof projectTreasuryProfile; chainId: 31337; executionEnabled: false;
  treasury: Address; creator: Address; controller: Address; intentId: Hex; treasuryShareBps: number;
  treasuryFactory: Address; coreFactory: Address; deployed: boolean; proof?: ProjectTreasuryProof;
  observed: ProjectTreasuryPoint; purchasesEnabled: false;
};
export type ProjectTreasuryTransaction = {
  type: "0x2"; chainId: "0x7a69"; from: Address; to: Address; value: Hex; data: Hex; nonce: Hex;
  gas: Hex; maxFeePerGas: Hex; maxPriorityFeePerGas: Hex;
};
export type ProjectTreasuryReview = {
  status: "prepared" | "needs-safe-approvals"; schemaVersion: 1; profile: typeof projectTreasuryProfile;
  chainId: 31337; scope: "isolated-local"; executionEnabled: false;
  operation: ProjectTreasuryOperation; actor: Address; controller: Address; creator: Address;
  kind: "eoa" | "metamask-7702" | "safe-inner"; intentId: Hex; treasury: Address;
  treasuryFactory: Address; coreFactory: Address; targetRuntimeHash: Hex; actorCodeHash: Hex;
  args: Record<string, string | number | boolean>;
  earningsRequest?: EarningsClaimRequest;
  request: ProjectTreasuryTransaction | null;
  innerCall: { from: Address; to: Address; data: Hex; value: Hex };
  observed: ProjectTreasuryPoint; expiresAt: number; maximumNetworkFeeWei: string;
  reviewHash: Hex; notices: string[];
};
export type ProjectTreasuryVerification = {
  schemaVersion: 1; profile: typeof projectTreasuryProfile; status: "pending" | "confirmed" | "reverted" | "unavailable";
  chainId: 31337; executionEnabled: false; reviewHash: Hex; transactionHash?: Hex;
  canonical?: ProjectTreasuryPoint; indexed?: boolean; proof?: ProjectTreasuryProof;
  snapshot?: ProjectTreasurySnapshot; reason?: string; finality: "synthetic-local-not-production";
};
export const treasuryAddress = (v: unknown): v is Address => typeof v === "string" && /^0x[0-9a-f]{40}$/i.test(v) && BigInt(v) > 0xffffn;
export const treasuryHash = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-f]{64}$/i.test(v) && BigInt(v) > 0n;
const uint = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 2n ** 256n;
const quantity = (v: unknown): v is Hex => typeof v === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(v);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const point = (p: ProjectTreasuryPoint) => p && /^[1-9][0-9]{0,15}$/.test(p.blockNumber) && treasuryHash(p.blockHash) && Number.isFinite(Date.parse(p.timestamp));
export function isProjectTreasuryProof(value: unknown): value is ProjectTreasuryProof {
  try {
    const p = value as ProjectTreasuryProof;
    return p.schemaVersion === 1 && p.profile === projectTreasuryProfile && p.chainId === 31337
      && [p.creator, p.controller, p.treasury, p.treasuryFactory, p.coreFactory].every(treasuryAddress)
      && [p.intentId, p.factoryRuntimeHash, p.runtimeHash, p.deployment.transactionHash].every(treasuryHash)
      && Number.isInteger(p.treasuryShareBps) && p.treasuryShareBps >= 0 && p.treasuryShareBps <= 9000
      && point(p.deployment) && Number.isSafeInteger(p.deployment.logIndex) && p.deployment.logIndex >= 0;
  } catch { return false; }
}
export function isProjectTreasuryPreview(value: unknown): value is ProjectTreasuryPreview {
  try {
    const p = value as ProjectTreasuryPreview;
    return p.status === "preview" && p.schemaVersion === 1 && p.profile === projectTreasuryProfile && p.chainId === 31337
      && p.executionEnabled === false && p.purchasesEnabled === false && [p.creator, p.controller, p.treasury, p.coreFactory, p.treasuryFactory].every(treasuryAddress)
      && treasuryHash(p.intentId) && Number.isInteger(p.treasuryShareBps) && p.treasuryShareBps >= 0 && p.treasuryShareBps <= 9000
      && typeof p.deployed === "boolean" && point(p.observed) && (!p.deployed || isProjectTreasuryProof(p.proof));
  } catch { return false; }
}
export function isProjectTreasurySnapshot(value: unknown): value is ProjectTreasurySnapshot {
  try {
    const s = value as ProjectTreasurySnapshot;
    return s.status === "ready" && s.schemaVersion === 1 && s.profile === projectTreasuryProfile && s.chainId === 31337 && s.scope === "isolated-local"
      && s.executionEnabled === false && isProjectTreasuryProof(s.proof) && same(s.treasury, s.proof.treasury) && same(s.creator, s.proof.creator)
      && treasuryAddress(s.controller) && uint(s.controllerEpoch) && same(s.intentId, s.proof.intentId) && s.treasuryShareBps === s.proof.treasuryShareBps
      && ["eoa", "metamask-7702", "safe-1.4.1", "unsupported"].includes(s.controllerKind) && point(s.observed)
      && ["unbound", "verified-unbound", "bound"].includes(s.project.status) && (s.project.token === null || treasuryAddress(s.project.token))
      && Array.isArray(s.assets) && s.assets.length <= 10 && s.assets.every(a => (a.address === null || treasuryAddress(a.address))
        && typeof a.symbol === "string" && a.symbol.length <= 32
        && [a.heldWei, a.availableWei, a.unclassifiedWei, a.manualWei, a.declaredFundingWei, a.unsolicitedWei, a.feesReceivedWei, a.purchasedWei, a.withdrawnWei, a.reservedWei].every(uint))
      && typeof s.purchases.enabled === "boolean" && typeof s.purchases.available === "boolean" && typeof s.purchases.reason === "string"
      && Array.isArray(s.events) && s.events.length <= 100 && s.events.every(e => treasuryHash(e.blockHash) && treasuryHash(e.transactionHash)
        && Number.isSafeInteger(e.logIndex) && e.logIndex >= 0 && /^[1-9][0-9]{0,15}$/.test(e.blockNumber))
      && Array.isArray(s.withdrawals) && s.withdrawals.length <= 16 && Array.isArray(s.notices) && s.notices.length <= 16;
  } catch { return false; }
}
export function projectTreasuryReviewHash(review: Omit<ProjectTreasuryReview, "reviewHash"> | ProjectTreasuryReview): Hex {
  const { reviewHash: _ignored, ...body } = review as ProjectTreasuryReview;
  return claimProfileDigest(body);
}
export function isProjectTreasuryReview(value: unknown): value is ProjectTreasuryReview {
  try {
    const r = value as ProjectTreasuryReview;
    if (!["prepared", "needs-safe-approvals"].includes(r.status) || r.schemaVersion !== 1 || r.profile !== projectTreasuryProfile
      || r.chainId !== 31337 || r.scope !== "isolated-local" || r.executionEnabled !== false
      || !projectTreasuryOperations.includes(r.operation) || !["eoa", "metamask-7702", "safe-inner"].includes(r.kind)
      || ![r.actor, r.creator, r.controller, r.treasury, r.treasuryFactory, r.coreFactory].every(treasuryAddress)
      || ![r.intentId, r.targetRuntimeHash, r.actorCodeHash, r.reviewHash].every(treasuryHash)
      || !point(r.observed) || !Number.isSafeInteger(r.expiresAt) || !uint(r.maximumNetworkFeeWei)
      || !r.args || typeof r.args !== "object" || Array.isArray(r.args) || Object.keys(r.args).length > 12
      || !treasuryAddress(r.innerCall.from) || !treasuryAddress(r.innerCall.to) || !quantity(r.innerCall.value)
      || typeof r.innerCall.data !== "string" || !/^0x[0-9a-f]+$/i.test(r.innerCall.data) || r.innerCall.data.length % 2 !== 0
      || r.innerCall.data.length < 10 || r.innerCall.data.length > (r.operation === "create-treasury" ? 67_000 : 8194)
      || !same(r.innerCall.from, r.actor) || !same(r.innerCall.to, r.operation === "create-treasury" ? r.treasuryFactory : r.treasury)
      || projectTreasuryReviewHash(r) !== r.reviewHash) return false;
    if (r.earningsRequest && (!isEarningsClaimRequest(r.earningsRequest) || !same(r.earningsRequest.from, r.treasury)
      || !same(r.earningsRequest.discoveryRecipient, r.treasury) || r.earningsRequest.chainId !== "0x7a69")) return false;
    if (r.status === "needs-safe-approvals") return r.kind === "safe-inner" && r.request === null && r.maximumNetworkFeeWei === "0";
    const q = r.request;
    return r.kind !== "safe-inner" && !!q && Object.keys(q).length === 10 && q.type === "0x2" && q.chainId === "0x7a69"
      && same(q.from, r.actor) && same(q.to, r.innerCall.to) && same(q.data, r.innerCall.data) && q.value === r.innerCall.value
      && [q.value, q.nonce, q.gas, q.maxFeePerGas, q.maxPriorityFeePerGas].every(quantity)
      && BigInt(q.gas) > 0n && BigInt(q.gas) * BigInt(q.maxFeePerGas) === BigInt(r.maximumNetworkFeeWei);
  } catch { return false; }
}
