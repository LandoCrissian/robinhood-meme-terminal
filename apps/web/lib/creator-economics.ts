import { keccak256, toHex, type Hex } from "viem";

export const MARKETPLACE_ECONOMICS_SCHEMA_VERSION = 1 as const;
export const MAX_MARKETPLACE_FEE_BPS = 1_000;

export type MarketplaceFeeAllocation = {
  platformOperationsBps: number;
  tokenFlywheelBps: number;
  creatorEcosystemBps: number;
  safetyReserveBps: number;
};

export type MarketplaceEconomicsPolicyDraft = {
  policyName: string;
  marketplaceFeeBps: number;
  allocation: MarketplaceFeeAllocation;
  tokenFlywheelMode: "none" | "governance_proposal";
  disclosure: string;
};

export type MarketplaceEconomicsPolicy = MarketplaceEconomicsPolicyDraft & {
  schemaVersion: typeof MARKETPLACE_ECONOMICS_SCHEMA_VERSION;
  policyHash: Hex;
  status: "draft";
};

export const EMPTY_MARKETPLACE_ECONOMICS_POLICY: MarketplaceEconomicsPolicyDraft = {
  policyName: "",
  marketplaceFeeBps: 0,
  allocation: {
    platformOperationsBps: 0,
    tokenFlywheelBps: 0,
    creatorEcosystemBps: 0,
    safetyReserveBps: 0
  },
  tokenFlywheelMode: "none",
  disclosure: ""
};

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function cleanBps(value: unknown, maximum = 10_000) {
  return Number.isInteger(value) ? Math.max(0, Math.min(maximum, Number(value))) : 0;
}

export function normalizeMarketplaceEconomicsPolicy(value: unknown): MarketplaceEconomicsPolicyDraft {
  const candidate = value && typeof value === "object"
    ? value as Partial<MarketplaceEconomicsPolicyDraft>
    : {};
  const allocation = candidate.allocation && typeof candidate.allocation === "object"
    ? candidate.allocation
    : EMPTY_MARKETPLACE_ECONOMICS_POLICY.allocation;
  const marketplaceFeeBps = cleanBps(candidate.marketplaceFeeBps, MAX_MARKETPLACE_FEE_BPS);
  return {
    policyName: cleanText(candidate.policyName, 80),
    marketplaceFeeBps,
    allocation: {
      platformOperationsBps: cleanBps(allocation.platformOperationsBps),
      tokenFlywheelBps: cleanBps(allocation.tokenFlywheelBps),
      creatorEcosystemBps: cleanBps(allocation.creatorEcosystemBps),
      safetyReserveBps: cleanBps(allocation.safetyReserveBps)
    },
    tokenFlywheelMode: marketplaceFeeBps > 0 && candidate.tokenFlywheelMode === "governance_proposal"
      ? "governance_proposal"
      : "none",
    disclosure: cleanText(candidate.disclosure, 1_000)
  };
}

export function validateMarketplaceEconomicsPolicy(value: MarketplaceEconomicsPolicyDraft) {
  const policy = normalizeMarketplaceEconomicsPolicy(value);
  if (policy.policyName.length < 3) return "Economics policy name must be at least 3 characters.";
  if (policy.marketplaceFeeBps < 1) return "A configured marketplace policy needs a positive disclosed fee.";
  const allocationTotal = Object.values(policy.allocation).reduce((total, share) => total + share, 0);
  if (allocationTotal !== 10_000) return "Platform fee allocations must total exactly 100%.";
  if (policy.allocation.tokenFlywheelBps > 0 && policy.tokenFlywheelMode !== "governance_proposal") {
    return "Token-directed allocations require a governance proposal boundary.";
  }
  if (policy.allocation.tokenFlywheelBps === 0 && policy.tokenFlywheelMode !== "none") {
    return "A policy without a token allocation cannot enable a token flywheel.";
  }
  if (policy.disclosure.length < 40) {
    return "Explain the fee, allocation, governance boundary, and absence of guaranteed returns.";
  }
  return null;
}

export function hashMarketplaceEconomicsPolicy(value: MarketplaceEconomicsPolicyDraft): Hex {
  const policy = normalizeMarketplaceEconomicsPolicy(value);
  return keccak256(toHex(JSON.stringify({
    schemaVersion: MARKETPLACE_ECONOMICS_SCHEMA_VERSION,
    ...policy,
    status: "draft"
  })));
}

export function createMarketplaceEconomicsPolicy(
  value: MarketplaceEconomicsPolicyDraft
): MarketplaceEconomicsPolicy {
  const policy = normalizeMarketplaceEconomicsPolicy(value);
  const validationError = validateMarketplaceEconomicsPolicy(policy);
  if (validationError) throw new Error(validationError);
  return {
    schemaVersion: MARKETPLACE_ECONOMICS_SCHEMA_VERSION,
    ...policy,
    policyHash: hashMarketplaceEconomicsPolicy(policy),
    status: "draft"
  };
}
