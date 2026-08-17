import { isAddress, isHash, getAddress, type Address, type Hex } from "viem";
import {
  atomicToDecimal,
  buildDistributionManifestV1,
  MAX_DISTRIBUTION_ROWS,
  parseDistributionCsvV1,
  type BuildDistributionManifestInput,
  type DistributionActionKind,
  type DistributionBatchV1,
  type DistributionEntryV1,
  type DistributionGasEvidenceV1,
  type DistributionInfrastructureV1,
  type DistributionManifestV1
} from "./distribution-domain";
import { OFFICIAL_RMT_DISTRIBUTION_RUNTIME_HASH, OFFICIAL_RMT_DISTRIBUTION_TOKEN } from "./distribution-deployment-readiness";
import { RMT_DISTRIBUTION_CHAIN_ID } from "./distribution-domain";

export type DistributionPlannerActionKind = DistributionActionKind;

export type DistributionPlannerMode = "planning-only";

export const DISTRIBUTION_PLANNER_MODE: DistributionPlannerMode = "planning-only";

export const DISTRIBUTION_PLANNER_NOT_APPROVED_LABEL = "NOT YET APPROVED";

export const DISTRIBUTION_PLANNER_DEFAULT_SENDER = "0x1111111111111111111111111111111111111111" as const;
export const DISTRIBUTION_PLANNER_DEFAULT_ASSET = "0x1111111111111111111111111111111111111114" as const;
export const DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS = 18;
export const DISTRIBUTION_PLANNER_DEFAULT_ENGINE = "0x1111111111111111111111111111111111111112" as const;
export const DISTRIBUTION_PLANNER_DEFAULT_RETIREMENT_SINK = "0x1111111111111111111111111111111111111113" as const;
export const DISTRIBUTION_PLANNER_DEFAULT_ENGINE_RUNTIME =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
export const DISTRIBUTION_PLANNER_DEFAULT_RETIREMENT_RUNTIME =
  "0x2222222222222222222222222222222222222222222222222222222222222222" as const;

export const DISTRIBUTION_PLANNER_RATE = {
  erc20: "1",
  erc721: "1",
  erc1155: "1"
} as const;

const DEFAULT_PLAN_GAS_SAMPLES = [
  { recipientCount: 1, gasUsed: "160000" },
  { recipientCount: 2, gasUsed: "240000" },
  { recipientCount: 4, gasUsed: "340000" },
  { recipientCount: 8, gasUsed: "500000" },
  { recipientCount: 12, gasUsed: "680000" },
  { recipientCount: 16, gasUsed: "760000" },
  { recipientCount: 20, gasUsed: "900000" }
] as const;

const DEFAULT_PLAN_GAS_EVIDENCE: Omit<BuildDistributionManifestInput["gasEvidence"], "evidenceHash"> = {
  chainId: RMT_DISTRIBUTION_CHAIN_ID,
  actionKind: "erc20_equal",
  measuredAtBlock: "46800000",
  blockGasLimit: "30000000",
  safetyMarginBps: 8000,
  source: "foundry_simulation",
  samples: [...DEFAULT_PLAN_GAS_SAMPLES]
};

function fail(message: string): never {
  throw new Error(`RMT rejected distribution planner input: ${message}`);
}

function normalizeAddress(raw: string, label: string): Address {
  if (!isAddress(raw, { strict: false })) fail(`${label} is not a valid EVM address`);
  return getAddress(raw);
}

function normalizeHash(raw: string, label: string): Hex {
  if (!isHash(raw)) fail(`${label} is not a valid bytes32 hash`);
  if (raw.toLowerCase() === `0x${"0".repeat(64)}`) fail(`${label} must not be zero`);
  return raw.toLowerCase() as Hex;
}

function normalizeDecimals(raw: string, actionKind: DistributionPlannerActionKind): number | null {
  if (actionKind === "erc721" || actionKind === "erc1155") {
    if (raw.trim() !== "") fail("NFT distributions must not provide decimals");
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) fail("ERC-20 decimals are required");
  if (!/^(0|[1-9]\d*)$/.test(trimmed)) fail("ERC-20 decimals must be a decimal integer");
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) fail("ERC-20 decimals must be 0-255");
  return parsed;
}

function countCsvRows(csv: string): number {
  if (!csv.trim()) return 0;
  const normalized = csv.replaceAll("\r\n", "\n").trimEnd();
  if (!normalized) return 0;
  const lines = normalized.split("\n");
  if (lines.length <= 1) return 0;
  return lines.length - 1;
}

function buildInfrastructure(): DistributionInfrastructureV1 {
  return {
    engine: normalizeAddress(DISTRIBUTION_PLANNER_DEFAULT_ENGINE, "engine"),
    engineRuntimeHash: normalizeHash(DISTRIBUTION_PLANNER_DEFAULT_ENGINE_RUNTIME, "engine runtime hash"),
    retirementSink: normalizeAddress(DISTRIBUTION_PLANNER_DEFAULT_RETIREMENT_SINK, "retirement sink"),
    retirementSinkRuntimeHash: normalizeHash(DISTRIBUTION_PLANNER_DEFAULT_RETIREMENT_RUNTIME, "retirement sink runtime hash"),
    rmtToken: normalizeAddress(OFFICIAL_RMT_DISTRIBUTION_TOKEN, "RMT token"),
    rmtTokenRuntimeHash: normalizeHash(OFFICIAL_RMT_DISTRIBUTION_RUNTIME_HASH, "RMT token runtime hash"),
    utilityPolicyVersion: 1,
    erc20CostPerRecipientAtomic: DISTRIBUTION_PLANNER_RATE.erc20,
    erc721CostPerRecipientAtomic: DISTRIBUTION_PLANNER_RATE.erc721,
    erc1155CostPerRecipientAtomic: DISTRIBUTION_PLANNER_RATE.erc1155
  };
}

function defaultGasEvidence(actionKind: DistributionPlannerActionKind): BuildDistributionManifestInput["gasEvidence"] {
  return {
    ...DEFAULT_PLAN_GAS_EVIDENCE,
    actionKind,
    samples: [...DEFAULT_PLAN_GAS_SAMPLES],
    safetyMarginBps: 8000
  } as BuildDistributionManifestInput["gasEvidence"];
}

export type DistributionPlannerInput = {
  actionKind: DistributionPlannerActionKind;
  assetAddress: string;
  assetDecimals: string;
  equalAmount: string;
  csv: string;
  senderAddress: string;
};

export type DistributionPlannerErrorState = {
  status: "error";
  actionKind: DistributionPlannerActionKind;
  message: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
};

export type DistributionPlannerReadyState = {
  status: "ready";
  actionKind: DistributionPlannerActionKind;
  sender: Address;
  assetAddress: Address;
  decimals: number | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  manifest: DistributionManifestV1;
  batches: DistributionBatchV1[];
  canonicalCsv: string;
  estimatedUtilityCostAtomic: string;
  estimatedAssetAmountAtomic: string;
  rowsPreview: DistributionEntryV1[];
};

export type DistributionPlannerState = DistributionPlannerErrorState | DistributionPlannerReadyState;

function emptyState(message: string): DistributionPlannerErrorState {
  return {
    status: "error",
    actionKind: "erc20_equal",
    message,
    totalRows: 0,
    validRows: 0,
    invalidRows: 0
  };
}

export function buildDistributionPlannerPreview(input: DistributionPlannerInput): DistributionPlannerState {
  const { actionKind, assetAddress, assetDecimals, equalAmount, csv, senderAddress } = input;

  if (!csv.trim()) {
    return emptyState("Paste CSV rows to begin planning.");
  }

  const totalRows = countCsvRows(csv);

  try {
    const sender = normalizeAddress(senderAddress, "sender");
    const asset = normalizeAddress(assetAddress, "asset");
    const decimals = normalizeDecimals(assetDecimals, actionKind);
    const standard = actionKind === "erc20_equal" || actionKind === "erc20_custom" ? "erc20" : actionKind;

    const parseInput = {
      actionKind,
      csv,
      decimals,
      sender,
      equalAmount: actionKind === "erc20_equal" ? equalAmount : undefined,
      engine: DISTRIBUTION_PLANNER_DEFAULT_ENGINE,
      retirementSink: DISTRIBUTION_PLANNER_DEFAULT_RETIREMENT_SINK
    };
    const parsed = parseDistributionCsvV1(parseInput);
    if (!parsed.canonicalCsv) fail("CSV normalization failed");
    if (parsed.entries.length > MAX_DISTRIBUTION_ROWS) fail("CSV exceeds the supported row limit");

    const manifest = buildDistributionManifestV1({
      sender,
      actionKind,
      asset: {
        chainId: RMT_DISTRIBUTION_CHAIN_ID,
        address: asset,
        standard,
        decimals
      },
      csv,
      equalAmount: actionKind === "erc20_equal" ? equalAmount : undefined,
      sourceEvidence: {
        snapshotBlock: null,
        sourceId: null,
        evidenceHash: null
      },
      infrastructure: buildInfrastructure(),
      gasEvidence: {
        ...defaultGasEvidence(actionKind),
        actionKind,
        samples: [...DEFAULT_PLAN_GAS_SAMPLES]
      }
    });

    const validRows = manifest.entries.length;
    return {
      status: "ready",
      actionKind,
      sender,
      assetAddress: asset,
      decimals,
      totalRows,
      validRows,
      invalidRows: Math.max(0, totalRows - validRows),
      manifest,
      batches: manifest.batches,
      canonicalCsv: manifest.canonicalCsv,
      estimatedUtilityCostAtomic: manifest.batches.reduce((sum, batch) => sum + BigInt(batch.utilityCostAtomic), 0n).toString(),
      estimatedAssetAmountAtomic: manifest.expectedTotalDistributionAtomic,
      rowsPreview: manifest.entries.slice(0, 20)
    };
  } catch (error) {
    return {
      status: "error",
      actionKind,
      message: error instanceof Error ? error.message : "Distribution planner could not parse inputs",
      totalRows,
      validRows: 0,
      invalidRows: Math.max(0, totalRows)
    };
  }
}

export function formatDistributionPreviewAmount(actionKind: DistributionPlannerActionKind, decimals: number | null, entry: DistributionEntryV1) {
  if (actionKind === "erc20_equal" || actionKind === "erc20_custom") {
    return atomicToDecimal(entry.amountAtomic ?? "0", decimals ?? 18);
  }
  if (actionKind === "erc721") {
    return `tokenId ${entry.tokenId ?? "0"}`;
  }
  return `${entry.tokenId ?? "0"} x ${atomicToDecimal(entry.amountAtomic ?? "0", 0)}`;
}

export function describeGasEvidence(actionKind: DistributionPlannerActionKind, evidence: DistributionGasEvidenceV1) {
  return `${actionKind} evidence (${evidence.source}) with ${evidence.samples.length} gas samples`;
}

export function summarizePlannerReadyState(state: DistributionPlannerReadyState) {
  return {
    rows: `${state.validRows}/${state.totalRows}`,
    batches: state.batches.length,
    manifestHash: state.manifest.manifestHash,
    utilityRate: DISTRIBUTION_PLANNER_NOT_APPROVED_LABEL
  };
}
