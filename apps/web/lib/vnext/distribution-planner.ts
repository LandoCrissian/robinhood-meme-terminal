import { isAddress, getAddress, type Address } from "viem";
import {
  atomicToDecimal,
  MAX_DISTRIBUTION_ROWS,
  parseDistributionCsvV1,
  type DistributionActionKind,
  type DistributionEntryV1,
} from "./distribution-domain";

export type DistributionPlannerActionKind = DistributionActionKind;

export type DistributionPlannerMode = "planning-only";

export const DISTRIBUTION_PLANNER_MODE: DistributionPlannerMode = "planning-only";

export const DISTRIBUTION_PLANNER_NOT_APPROVED_LABEL = "NOT YET APPROVED";

export const DISTRIBUTION_PLANNER_DEFAULT_SENDER = "0x1111111111111111111111111111111111111111" as const;
export const DISTRIBUTION_PLANNER_DEFAULT_ASSET = "0x1111111111111111111111111111111111111114" as const;
export const DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS = 18;

function fail(message: string): never {
  throw new Error(`RMT rejected distribution planner input: ${message}`);
}

function normalizeAddress(raw: string, label: string): Address {
  if (!isAddress(raw, { strict: false })) fail(`${label} is not a valid EVM address`);
  return getAddress(raw);
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
  canonicalCsv: string;
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
    const parseInput = {
      actionKind,
      csv,
      decimals,
      sender,
      equalAmount: actionKind === "erc20_equal" ? equalAmount : undefined,
      engine: sender,
      retirementSink: sender
    };
    const parsed = parseDistributionCsvV1(parseInput);
    if (!parsed.canonicalCsv) fail("CSV normalization failed");
    if (parsed.entries.length > MAX_DISTRIBUTION_ROWS) fail("CSV exceeds the supported row limit");

    const validRows = parsed.entries.length;
    const estimatedAssetAmountAtomic = parsed.entries.reduce((sum, entry) => {
      if (entry.amountAtomic) return sum + BigInt(entry.amountAtomic);
      if (actionKind === "erc721") return sum + 1n;
      return sum;
    }, 0n);
    return {
      status: "ready",
      actionKind,
      sender,
      assetAddress: asset,
      decimals,
      totalRows,
      validRows,
      invalidRows: Math.max(0, totalRows - validRows),
      canonicalCsv: parsed.canonicalCsv,
      estimatedAssetAmountAtomic: estimatedAssetAmountAtomic.toString(),
      rowsPreview: parsed.entries.slice(0, 20)
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

export function summarizePlannerReadyState(state: DistributionPlannerReadyState) {
  return {
    rows: `${state.validRows}/${state.totalRows}`,
    rowsPreview: state.rowsPreview.length,
    assetTotal: state.estimatedAssetAmountAtomic,
    utilityRate: DISTRIBUTION_PLANNER_NOT_APPROVED_LABEL
  };
}
