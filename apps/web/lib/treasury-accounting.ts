import { getAddress, isAddress, keccak256, toHex, type Address, type Hex } from "viem";
import {
  createProtocolTreasuryAllocation,
  type ProtocolTreasuryAllocationPolicy
} from "./token-fee-economics";

export const TREASURY_ACCOUNTING_SCHEMA_VERSION = 1 as const;

export const TREASURY_REVENUE_SOURCES = [
  "token_curve_protocol_fee",
  "token_v4_protocol_fee",
  "creator_marketplace_platform_fee",
  "listing_or_advertising_revenue",
  "project_subscription",
  "referral_revenue",
  "sponsorship",
  "grant",
  "other_disclosed"
] as const;

export const TREASURY_ALLOCATION_CATEGORIES = [
  "platformGrowth",
  "projectSupport",
  "holderIncentives",
  "governedTokenActions",
  "safetyReserve"
] as const;

export type TreasuryRevenueSource = typeof TREASURY_REVENUE_SOURCES[number];
export type TreasuryAllocationCategory = typeof TREASURY_ALLOCATION_CATEGORIES[number];

export type TreasuryAsset = {
  chainId: number;
  address: "native" | Address;
  symbol: string;
  decimals: number;
};

export type TreasuryEvidence =
  | {
    kind: "onchain_event";
    chainId: number;
    transactionHash: Hex;
    logIndex: number;
    blockNumber: string;
  }
  | {
    kind: "offchain_receipt";
    evidenceHash: Hex;
    reference: string;
  };

export type TreasuryLedgerEntryInput = {
  source: TreasuryRevenueSource;
  asset: TreasuryAsset;
  amountAtomic: string;
  evidence: TreasuryEvidence;
  receivedAt: string;
  disclosure: string;
  sourcePolicyHash?: Hex;
};

export type TreasuryLedgerEntry = TreasuryLedgerEntryInput & {
  schemaVersion: typeof TREASURY_ACCOUNTING_SCHEMA_VERSION;
  evidenceKey: Hex;
  entryHash: Hex;
  accountingMode: "evidence_only";
};

export type TreasurySourceReservation = {
  entryHash: Hex;
  amountAtomic: string;
};

export type TreasuryAllocationLine = {
  category: TreasuryAllocationCategory;
  amountAtomic: string;
  shareBps: number;
};

export type TreasuryAllocationProposal = {
  schemaVersion: typeof TREASURY_ACCOUNTING_SCHEMA_VERSION;
  proposalHash: Hex;
  policyHash: Hex;
  title: string;
  rationale: string;
  asset: TreasuryAsset;
  reservations: TreasurySourceReservation[];
  allocations: TreasuryAllocationLine[];
  totalAmountAtomic: string;
  status: "draft";
  governanceRequired: true;
  transactionPayload: null;
  contractExecution: "disabled";
};

type TreasuryAllocationInput = {
  policy: ProtocolTreasuryAllocationPolicy;
  title: string;
  rationale: string;
  asset: TreasuryAsset;
  reservations: TreasurySourceReservation[];
  ledger: TreasuryLedgerEntry[];
  existingProposals?: TreasuryAllocationProposal[];
};

function canonicalAtomic(value: unknown, allowZero = false) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("Treasury amounts must use canonical non-negative atomic-unit strings.");
  }
  const amount = BigInt(value);
  if (!allowZero && amount === 0n) throw new Error("Treasury amounts must be positive.");
  return amount.toString();
}

function canonicalHex(value: unknown, bytes: number) {
  if (typeof value !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)) {
    throw new Error(`Expected a ${bytes}-byte hexadecimal value.`);
  }
  return value.toLowerCase() as Hex;
}

function canonicalAsset(value: TreasuryAsset): TreasuryAsset {
  if (!Number.isSafeInteger(value.chainId) || value.chainId < 1) {
    throw new Error("Treasury assets require a positive chain ID.");
  }
  if (!Number.isInteger(value.decimals) || value.decimals < 0 || value.decimals > 255) {
    throw new Error("Treasury asset decimals are invalid.");
  }
  const symbol = value.symbol.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{1,16}$/.test(symbol)) throw new Error("Treasury asset symbol is invalid.");
  if (value.address !== "native" && !isAddress(value.address, { strict: false })) {
    throw new Error("Treasury asset address is invalid.");
  }
  return {
    chainId: value.chainId,
    address: value.address === "native" ? "native" : getAddress(value.address),
    symbol,
    decimals: value.decimals
  };
}

function assetKey(value: TreasuryAsset) {
  const asset = canonicalAsset(value);
  return `${asset.chainId}:${asset.address.toLowerCase()}:${asset.decimals}`;
}

function canonicalEvidence(value: TreasuryEvidence): TreasuryEvidence {
  if (value.kind === "onchain_event") {
    if (!Number.isSafeInteger(value.chainId) || value.chainId < 1) {
      throw new Error("Onchain evidence requires a positive chain ID.");
    }
    if (!Number.isSafeInteger(value.logIndex) || value.logIndex < 0) {
      throw new Error("Onchain evidence requires a valid log index.");
    }
    return {
      kind: "onchain_event",
      chainId: value.chainId,
      transactionHash: canonicalHex(value.transactionHash, 32),
      logIndex: value.logIndex,
      blockNumber: canonicalAtomic(value.blockNumber)
    };
  }
  const reference = value.reference.trim().slice(0, 500);
  if (reference.length < 8) throw new Error("Offchain evidence requires a meaningful reference.");
  return {
    kind: "offchain_receipt",
    evidenceHash: canonicalHex(value.evidenceHash, 32),
    reference
  };
}

function canonicalDate(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new Error("Treasury receipt date is invalid.");
  return date.toISOString();
}

function canonicalDisclosure(value: string, minimum: number) {
  const disclosure = value.trim().slice(0, 1_200);
  if (disclosure.length < minimum) throw new Error("Treasury records require a clear public disclosure.");
  return disclosure;
}

export function createTreasuryLedgerEntry(input: TreasuryLedgerEntryInput): TreasuryLedgerEntry {
  if (!TREASURY_REVENUE_SOURCES.includes(input.source)) throw new Error("Treasury revenue source is invalid.");
  const asset = canonicalAsset(input.asset);
  const evidence = canonicalEvidence(input.evidence);
  if (evidence.kind === "onchain_event" && evidence.chainId !== asset.chainId) {
    throw new Error("Treasury asset and evidence chain IDs must match.");
  }
  const sourcePolicyHash = input.sourcePolicyHash === undefined
    ? undefined
    : canonicalHex(input.sourcePolicyHash, 32);
  if (
    (
      input.source === "token_curve_protocol_fee"
      || input.source === "token_v4_protocol_fee"
      || input.source === "creator_marketplace_platform_fee"
    )
    && sourcePolicyHash === undefined
  ) {
    throw new Error("Policy-bound treasury receipts require the exact source-policy hash.");
  }
  const payload = {
    schemaVersion: TREASURY_ACCOUNTING_SCHEMA_VERSION,
    source: input.source,
    asset,
    amountAtomic: canonicalAtomic(input.amountAtomic),
    evidence,
    receivedAt: canonicalDate(input.receivedAt),
    disclosure: canonicalDisclosure(input.disclosure, 40),
    ...(sourcePolicyHash ? { sourcePolicyHash } : {}),
    accountingMode: "evidence_only" as const
  };
  const evidenceAnchor = evidence.kind === "onchain_event"
    ? {
      kind: evidence.kind,
      chainId: evidence.chainId,
      transactionHash: evidence.transactionHash,
      logIndex: evidence.logIndex
    }
    : {
      kind: evidence.kind,
      evidenceHash: evidence.evidenceHash
    };
  const evidenceKey = keccak256(toHex(JSON.stringify(evidenceAnchor)));
  return {
    ...payload,
    evidenceKey,
    entryHash: keccak256(toHex(JSON.stringify({ ...payload, evidenceKey })))
  };
}

export function validateTreasuryLedger(entries: TreasuryLedgerEntry[]) {
  const evidenceKeys = new Set<string>();
  const entryHashes = new Set<string>();
  for (const entry of entries) {
    const parsed = createTreasuryLedgerEntry(entry);
    if (parsed.entryHash !== entry.entryHash || parsed.evidenceKey !== entry.evidenceKey) {
      throw new Error("Treasury ledger entry fingerprint mismatch.");
    }
    if (evidenceKeys.has(parsed.evidenceKey)) throw new Error("Treasury evidence cannot be counted twice.");
    if (entryHashes.has(parsed.entryHash)) throw new Error("Treasury ledger entries must be unique.");
    evidenceKeys.add(parsed.evidenceKey);
    entryHashes.add(parsed.entryHash);
  }
  return true;
}

export function summarizeTreasuryLedger(entries: TreasuryLedgerEntry[]) {
  validateTreasuryLedger(entries);
  const balances = new Map<string, {
    asset: TreasuryAsset;
    totalAtomic: bigint;
    bySource: Map<TreasuryRevenueSource, bigint>;
  }>();
  for (const entry of entries) {
    const key = assetKey(entry.asset);
    const balance = balances.get(key) ?? {
      asset: canonicalAsset(entry.asset),
      totalAtomic: 0n,
      bySource: new Map<TreasuryRevenueSource, bigint>()
    };
    const amount = BigInt(entry.amountAtomic);
    balance.totalAtomic += amount;
    balance.bySource.set(entry.source, (balance.bySource.get(entry.source) ?? 0n) + amount);
    balances.set(key, balance);
  }
  return [...balances.values()].map((balance) => ({
    asset: balance.asset,
    totalAmountAtomic: balance.totalAtomic.toString(),
    sources: [...balance.bySource.entries()].map(([source, amount]) => ({
      source,
      amountAtomic: amount.toString()
    }))
  }));
}

function allocationBps(policy: ProtocolTreasuryAllocationPolicy): Record<TreasuryAllocationCategory, number> {
  return {
    platformGrowth: policy.allocation.platformGrowthBps,
    projectSupport: policy.allocation.projectSupportBps,
    holderIncentives: policy.allocation.holderIncentivesBps,
    governedTokenActions: policy.allocation.governedTokenActionsBps,
    safetyReserve: policy.allocation.safetyReserveBps
  };
}

function splitByPolicy(total: bigint, policy: ProtocolTreasuryAllocationPolicy): TreasuryAllocationLine[] {
  const shares = allocationBps(policy);
  let cumulativeBps = 0n;
  let previousBoundary = 0n;
  return TREASURY_ALLOCATION_CATEGORIES.map((category) => {
    cumulativeBps += BigInt(shares[category]);
    const boundary = total * cumulativeBps / 10_000n;
    const amount = boundary - previousBoundary;
    previousBoundary = boundary;
    return { category, amountAtomic: amount.toString(), shareBps: shares[category] };
  });
}

export function createTreasuryAllocationProposal(input: TreasuryAllocationInput): TreasuryAllocationProposal {
  validateTreasuryLedger(input.ledger);
  const verifiedPolicy = createProtocolTreasuryAllocation(input.policy);
  if (verifiedPolicy.policyHash !== input.policy.policyHash) {
    throw new Error("Treasury allocation policy fingerprint mismatch.");
  }
  const title = input.title.trim().slice(0, 100);
  const rationale = canonicalDisclosure(input.rationale, 80);
  if (title.length < 5) throw new Error("Treasury proposal title is too short.");
  const asset = canonicalAsset(input.asset);
  if (input.reservations.length === 0) throw new Error("Treasury proposals require source reservations.");

  const entries = new Map(input.ledger.map((entry) => [entry.entryHash, entry]));
  const reservedByEntry = new Map<Hex, bigint>();
  for (const proposal of input.existingProposals ?? []) {
    if (proposal.status !== "draft") continue;
    for (const reservation of proposal.reservations) {
      reservedByEntry.set(
        reservation.entryHash,
        (reservedByEntry.get(reservation.entryHash) ?? 0n) + BigInt(canonicalAtomic(reservation.amountAtomic))
      );
    }
  }

  const seen = new Set<string>();
  const reservations = input.reservations.map((reservation) => {
    const entryHash = canonicalHex(reservation.entryHash, 32);
    if (seen.has(entryHash)) throw new Error("A proposal cannot repeat a source entry.");
    seen.add(entryHash);
    const entry = entries.get(entryHash);
    if (!entry) throw new Error("Treasury proposal references an unknown source entry.");
    if (assetKey(entry.asset) !== assetKey(asset)) {
      throw new Error("Treasury proposals cannot combine different assets.");
    }
    const amount = BigInt(canonicalAtomic(reservation.amountAtomic));
    const alreadyReserved = reservedByEntry.get(entryHash) ?? 0n;
    if (amount + alreadyReserved > BigInt(entry.amountAtomic)) {
      throw new Error("Treasury proposal exceeds the unreserved source balance.");
    }
    return { entryHash, amountAtomic: amount.toString() };
  });
  const total = reservations.reduce((sum, reservation) => sum + BigInt(reservation.amountAtomic), 0n);
  const allocations = splitByPolicy(total, verifiedPolicy);
  const payload = {
    schemaVersion: TREASURY_ACCOUNTING_SCHEMA_VERSION,
    policyHash: input.policy.policyHash,
    title,
    rationale,
    asset,
    reservations,
    allocations,
    totalAmountAtomic: total.toString(),
    status: "draft" as const,
    governanceRequired: true as const,
    transactionPayload: null,
    contractExecution: "disabled" as const
  };
  return {
    ...payload,
    proposalHash: keccak256(toHex(JSON.stringify(payload)))
  };
}
