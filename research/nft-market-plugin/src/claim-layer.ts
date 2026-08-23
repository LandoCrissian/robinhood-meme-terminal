import {
  RMT_ECOSYSTEM_CHAIN_ID,
  admissionAtLeast,
  canonicalId,
  canonicalUint,
  normalizeBytes32,
  normalizeEvmAddress,
  type ProjectCapabilityRegistration
} from "./ecosystem-capabilities.ts";

export type ClaimKind =
  | "escrow_drop"
  | "async_deposit"
  | "async_redeem"
  | "vesting"
  | "airdrop"
  | "distribution"
  | "bridge_refund"
  | "subscription_entitlement"
  | "lending_withdrawal"
  | "fee_collection"
  | "other";

export type ClaimState =
  | "unknown"
  | "pending"
  | "claimable"
  | "partially_claimable"
  | "claimed"
  | "expired"
  | "refundable"
  | "cancelled"
  | "blocked";

export type ClaimActionKind = "claim" | "refund" | "cancel" | "complete_deposit" | "complete_redeem" | "collect" | "exercise";

export type ClaimLocator =
  | { kind: "bytes32"; value: string }
  | { kind: "uint256"; value: string }
  | { kind: "opaque"; value: string };

export type ClaimAssetIdentity =
  | { kind: "native"; chainId: typeof RMT_ECOSYSTEM_CHAIN_ID; symbol: "ETH"; amountAtomic: string | null }
  | { kind: "erc20" | "vault_share"; chainId: typeof RMT_ECOSYSTEM_CHAIN_ID; address: string; amountAtomic: string | null; decimals: number | null }
  | { kind: "erc721"; chainId: typeof RMT_ECOSYSTEM_CHAIN_ID; address: string; tokenId: string }
  | { kind: "erc1155"; chainId: typeof RMT_ECOSYSTEM_CHAIN_ID; address: string; tokenId: string; amountAtomic: string | null }
  | { kind: "unknown"; chainId: typeof RMT_ECOSYSTEM_CHAIN_ID; description: string };

export type ClaimComplianceState = "not_applicable" | "allowed" | "blocked" | "requires_fresh_check" | "unknown";
export type ClaimTransferability = "nontransferable" | "transferable" | "restricted" | "unknown";

export type ClaimPositionSnapshot = {
  schemaVersion: 1;
  sourceCapabilityId: string;
  sourceContract: string;
  locator: ClaimLocator;
  kind: ClaimKind;
  beneficiary: string;
  controller: string | null;
  asset: ClaimAssetIdentity;
  state: ClaimState;
  amountState: "exact" | "estimated" | "unknown";
  transferability: ClaimTransferability;
  complianceState: ClaimComplianceState;
  requestedAtMs: number | null;
  claimableAtMs: number | null;
  expiresAtMs: number | null;
  observedRollupBlock: string;
  observedAtMs: number;
  evidenceState: "reported" | "verified" | "conflicting" | "revoked";
  sourceRef: string;
};

export type ClaimActionEvidence = {
  schemaVersion: 1;
  claimKey: string;
  action: ClaimActionKind;
  adapterId: string;
  adapterVersion: number;
  target: string;
  calldataHash: string;
  transactionValueAtomic: string;
  recipient: string;
  deadlineMs: number;
  verificationState: "planned" | "verified";
  freshStateRequired: true;
  broadArbitraryCallAllowed: false;
  rmtExecutionFeePolicy: null;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid RMT claim position: ${message}.`);
}

function assertTime(value: number | null, label: string) {
  invariant(value === null || (Number.isSafeInteger(value) && value > 0), `${label} is invalid`);
}

export function assertClaimAsset(asset: ClaimAssetIdentity) {
  invariant(asset.chainId === RMT_ECOSYSTEM_CHAIN_ID, "claim asset is on the wrong chain");
  if (asset.kind === "unknown") {
    invariant(asset.description.trim().length > 0, "unknown asset lacks a description");
    return true;
  }
  if (asset.kind !== "native") normalizeEvmAddress(asset.address, "claim asset address");
  if (asset.kind === "erc721" || asset.kind === "erc1155") canonicalUint(asset.tokenId, "claim token ID");
  if ("amountAtomic" in asset && asset.amountAtomic !== null) canonicalUint(asset.amountAtomic, "claim amount");
  if ((asset.kind === "erc20" || asset.kind === "vault_share") && asset.decimals !== null) {
    invariant(Number.isInteger(asset.decimals) && asset.decimals >= 0 && asset.decimals <= 255, "claim asset decimals are invalid");
  }
  return true;
}

export function claimLocatorKey(locator: ClaimLocator) {
  if (locator.kind === "bytes32") return `bytes32:${normalizeBytes32(locator.value, "claim ID")}`;
  if (locator.kind === "uint256") return `uint256:${canonicalUint(locator.value, "claim ID")}`;
  invariant(locator.value.trim().length > 0 && locator.value.length <= 256, "opaque claim ID is invalid");
  return `opaque:${locator.value}`;
}

export function claimKey(claim: Pick<ClaimPositionSnapshot, "sourceContract" | "locator">) {
  return `eip155:${RMT_ECOSYSTEM_CHAIN_ID}/contract:${normalizeEvmAddress(claim.sourceContract)}/claim:${claimLocatorKey(claim.locator)}`;
}

export function assertClaimPosition(claim: ClaimPositionSnapshot) {
  invariant(claim.schemaVersion === 1, "claim schema version is unsupported");
  canonicalId(claim.sourceCapabilityId, "source capability ID");
  normalizeEvmAddress(claim.sourceContract, "claim source contract");
  claimLocatorKey(claim.locator);
  normalizeEvmAddress(claim.beneficiary, "claim beneficiary");
  if (claim.controller !== null) normalizeEvmAddress(claim.controller, "claim controller");
  assertClaimAsset(claim.asset);
  assertTime(claim.requestedAtMs, "request time");
  assertTime(claim.claimableAtMs, "claimable time");
  assertTime(claim.expiresAtMs, "expiry time");
  canonicalUint(claim.observedRollupBlock, "observed rollup block");
  invariant(Number.isSafeInteger(claim.observedAtMs) && claim.observedAtMs > 0, "observation timestamp is invalid");
  invariant(claim.sourceRef.trim().length > 0, "claim source reference is missing");
  if (claim.amountState === "exact") {
    invariant(claim.asset.kind !== "unknown", "exact claim cannot use an unknown asset");
    if ("amountAtomic" in claim.asset) invariant(claim.asset.amountAtomic !== null, "exact claim lacks an amount");
  }
  if (claim.evidenceState === "revoked" || claim.evidenceState === "conflicting") {
    invariant(claim.state === "blocked" || claim.state === "unknown" || claim.state === "cancelled", "revoked/conflicting evidence remains actionable");
  }
  if (claim.complianceState === "blocked") invariant(claim.state === "blocked" || claim.state === "pending", "compliance-blocked claim is exposed as immediately actionable");
  return true;
}

function actionAllowedByState(action: ClaimActionKind, state: ClaimState) {
  if (action === "claim" || action === "collect" || action === "exercise") return state === "claimable" || state === "partially_claimable";
  if (action === "refund") return state === "refundable" || state === "expired";
  if (action === "cancel") return state === "pending";
  return state === "claimable" || state === "pending";
}

export function buildClaimActionEvidence(input: {
  claim: ClaimPositionSnapshot;
  capability: ProjectCapabilityRegistration;
  action: ClaimActionKind;
  adapterId: string;
  adapterVersion: number;
  target: string;
  calldataHash: string;
  transactionValueAtomic?: string;
  recipient: string;
  deadlineMs: number;
  nowMs: number;
  verificationState?: "planned" | "verified";
}): ClaimActionEvidence {
  assertClaimPosition(input.claim);
  invariant(input.capability.capabilityId === input.claim.sourceCapabilityId, "claim capability identity changed");
  invariant(input.capability.authorityDimension === "claim_source", "capability is not a claim-source authority");
  invariant(admissionAtLeast(input.capability.admissionState, "verification_ready"), "claim source is not verification-ready");
  invariant(input.claim.evidenceState === "verified", "claim evidence is not verified");
  invariant(actionAllowedByState(input.action, input.claim.state), "claim state does not permit the requested action");
  invariant(input.claim.complianceState === "allowed" || input.claim.complianceState === "not_applicable", "claim compliance is not currently allowed");
  invariant(input.claim.expiresAtMs === null || input.claim.expiresAtMs > input.nowMs, "claim is expired");
  invariant(input.deadlineMs > input.nowMs && Number.isSafeInteger(input.deadlineMs), "claim action deadline is invalid");
  invariant(Number.isInteger(input.adapterVersion) && input.adapterVersion > 0, "claim adapter version is invalid");
  canonicalId(input.adapterId, "claim adapter ID");
  normalizeEvmAddress(input.target, "claim target");
  normalizeBytes32(input.calldataHash, "claim calldata hash");
  normalizeEvmAddress(input.recipient, "claim recipient");
  const transactionValueAtomic = canonicalUint(input.transactionValueAtomic ?? "0", "claim transaction value");
  return Object.freeze({
    schemaVersion: 1,
    claimKey: claimKey(input.claim),
    action: input.action,
    adapterId: input.adapterId,
    adapterVersion: input.adapterVersion,
    target: normalizeEvmAddress(input.target),
    calldataHash: normalizeBytes32(input.calldataHash),
    transactionValueAtomic,
    recipient: normalizeEvmAddress(input.recipient),
    deadlineMs: input.deadlineMs,
    verificationState: input.verificationState ?? "planned",
    freshStateRequired: true,
    broadArbitraryCallAllowed: false,
    rmtExecutionFeePolicy: null
  });
}

export function claimPortfolioSummary(claims: readonly ClaimPositionSnapshot[]) {
  const summary: Record<ClaimState, number> = {
    unknown: 0,
    pending: 0,
    claimable: 0,
    partially_claimable: 0,
    claimed: 0,
    expired: 0,
    refundable: 0,
    cancelled: 0,
    blocked: 0
  };
  const unique = new Set<string>();
  for (const claim of claims) {
    assertClaimPosition(claim);
    const key = claimKey(claim);
    invariant(!unique.has(key), "claim portfolio duplicates a canonical claim identity");
    unique.add(key);
    summary[claim.state] += 1;
  }
  return Object.freeze({ total: claims.length, byState: Object.freeze(summary) });
}
