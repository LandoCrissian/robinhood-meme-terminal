import { keccak256, toHex, type Hex } from "viem";

export const TOKEN_FEE_ECONOMICS_SCHEMA_VERSION = 1 as const;
export const TOKEN_MARKET_CREATOR_SHARE_BPS = 7_000 as const;
export const TOKEN_MARKET_PROTOCOL_SHARE_BPS = 3_000 as const;

export type ProtocolTreasuryAllocation = {
  platformGrowthBps: number;
  projectSupportBps: number;
  holderIncentivesBps: number;
  governedTokenActionsBps: number;
  safetyReserveBps: number;
};

export type ProtocolTreasuryAllocationDraft = {
  policyName: string;
  allocation: ProtocolTreasuryAllocation;
  disclosure: string;
  governanceRequired: true;
  status: "draft";
};

export type ProtocolTreasuryAllocationPolicy = ProtocolTreasuryAllocationDraft & {
  schemaVersion: typeof TOKEN_FEE_ECONOMICS_SCHEMA_VERSION;
  policyHash: Hex;
};

export const EMPTY_PROTOCOL_TREASURY_ALLOCATION: ProtocolTreasuryAllocationDraft = {
  policyName: "",
  allocation: {
    platformGrowthBps: 0,
    projectSupportBps: 0,
    holderIncentivesBps: 0,
    governedTokenActionsBps: 0,
    safetyReserveBps: 0
  },
  disclosure: "",
  governanceRequired: true,
  status: "draft"
};

function cleanBps(value: unknown) {
  return Number.isInteger(value) ? Math.max(0, Math.min(10_000, Number(value))) : 0;
}

export function normalizeProtocolTreasuryAllocation(value: unknown): ProtocolTreasuryAllocationDraft {
  const candidate = value && typeof value === "object"
    ? value as Partial<ProtocolTreasuryAllocationDraft>
    : {};
  const allocation = candidate.allocation && typeof candidate.allocation === "object"
    ? candidate.allocation
    : EMPTY_PROTOCOL_TREASURY_ALLOCATION.allocation;
  return {
    policyName: typeof candidate.policyName === "string" ? candidate.policyName.trim().slice(0, 80) : "",
    allocation: {
      platformGrowthBps: cleanBps(allocation.platformGrowthBps),
      projectSupportBps: cleanBps(allocation.projectSupportBps),
      holderIncentivesBps: cleanBps(allocation.holderIncentivesBps),
      governedTokenActionsBps: cleanBps(allocation.governedTokenActionsBps),
      safetyReserveBps: cleanBps(allocation.safetyReserveBps)
    },
    disclosure: typeof candidate.disclosure === "string" ? candidate.disclosure.trim().slice(0, 1_200) : "",
    governanceRequired: true,
    status: "draft"
  };
}

export function validateProtocolTreasuryAllocation(value: ProtocolTreasuryAllocationDraft) {
  const policy = normalizeProtocolTreasuryAllocation(value);
  const total = Object.values(policy.allocation).reduce((sum, share) => sum + share, 0);
  if (policy.policyName.length < 3) return "Treasury allocation policy name must be at least 3 characters.";
  if (total !== 10_000) return "Allocations of RMT's 30% protocol share must total exactly 100%.";
  if (policy.disclosure.length < 80) {
    return "Disclose the intended uses, governance boundary, eligibility rules, and absence of guaranteed holder returns.";
  }
  return null;
}

export function createProtocolTreasuryAllocation(
  value: ProtocolTreasuryAllocationDraft
): ProtocolTreasuryAllocationPolicy {
  const policy = normalizeProtocolTreasuryAllocation(value);
  const error = validateProtocolTreasuryAllocation(policy);
  if (error) throw new Error(error);
  const hashPayload = {
    schemaVersion: TOKEN_FEE_ECONOMICS_SCHEMA_VERSION,
    tokenMarketCreatorShareBps: TOKEN_MARKET_CREATOR_SHARE_BPS,
    tokenMarketProtocolShareBps: TOKEN_MARKET_PROTOCOL_SHARE_BPS,
    ...policy
  };
  return {
    schemaVersion: TOKEN_FEE_ECONOMICS_SCHEMA_VERSION,
    ...policy,
    policyHash: keccak256(toHex(JSON.stringify(hashPayload)))
  };
}
