import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  isHash,
  keccak256,
  toBytes,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import { z } from "zod";

export const RMT_DISTRIBUTION_SCHEMA_VERSION = 1 as const;
export const RMT_DISTRIBUTION_CHAIN_ID = 4_663 as const;
export const MAX_DISTRIBUTION_ROWS = 10_000;
export const UINT256_MAX = (1n << 256n) - 1n;

export type DistributionActionKind = "erc20_equal" | "erc20_custom" | "erc721" | "erc1155";
export type DistributionTokenStandard = "erc20" | "erc721" | "erc1155";

export type DistributionAssetIdentity = {
  chainId: typeof RMT_DISTRIBUTION_CHAIN_ID;
  address: Address;
  standard: DistributionTokenStandard;
  decimals: number | null;
};

export type DistributionEntryV1 = {
  recipient: Address;
  amountAtomic: string | null;
  tokenId: string | null;
};

export type DistributionSourceEvidenceV1 = {
  snapshotBlock: string | null;
  sourceId: string | null;
  evidenceHash: Hex | null;
};

export type DistributionInfrastructureV1 = {
  engine: Address;
  engineRuntimeHash: Hex;
  retirementSink: Address;
  retirementSinkRuntimeHash: Hex;
  rmtToken: Address;
  rmtTokenRuntimeHash: Hex;
  utilityPolicyVersion: number;
  erc20CostPerRecipientAtomic: string;
  erc721CostPerRecipientAtomic: string;
  erc1155CostPerRecipientAtomic: string;
};

export type DistributionGasSampleV1 = {
  recipientCount: number;
  gasUsed: string;
};

export type DistributionGasEvidenceV1 = {
  chainId: typeof RMT_DISTRIBUTION_CHAIN_ID;
  actionKind: DistributionActionKind;
  measuredAtBlock: string;
  blockGasLimit: string;
  safetyMarginBps: number;
  source: "foundry_simulation" | "fork_simulation";
  samples: DistributionGasSampleV1[];
  evidenceHash: Hex;
};

export type DistributionBatchV1 = {
  schemaVersion: typeof RMT_DISTRIBUTION_SCHEMA_VERSION;
  manifestHash: Hex;
  batchIndex: number;
  batchId: Hex;
  batchHash: Hex;
  recipientCount: number;
  entries: DistributionEntryV1[];
  totalAssetAmountAtomic: string;
  utilityCostAtomic: string;
  conservativeGasEstimate: string;
};

export type DistributionManifestCoreV1 = {
  schemaVersion: typeof RMT_DISTRIBUTION_SCHEMA_VERSION;
  chainId: typeof RMT_DISTRIBUTION_CHAIN_ID;
  sender: Address;
  actionKind: DistributionActionKind;
  asset: DistributionAssetIdentity;
  entries: DistributionEntryV1[];
  sourceEvidence: DistributionSourceEvidenceV1;
  infrastructure: DistributionInfrastructureV1;
  gasEvidence: DistributionGasEvidenceV1;
  expectedTotalDistributionAtomic: string;
  expectedTotalRmtRetirementAtomic: string;
};

export type DistributionManifestV1 = DistributionManifestCoreV1 & {
  manifestHash: Hex;
  canonicalCsv: string;
  batches: DistributionBatchV1[];
};

export type BuildDistributionManifestInput = {
  sender: string;
  actionKind: DistributionActionKind;
  asset: {
    chainId: number;
    address: string;
    standard: DistributionTokenStandard;
    decimals: number | null;
  };
  csv: string;
  equalAmount?: string;
  sourceEvidence?: Partial<DistributionSourceEvidenceV1>;
  infrastructure: {
    engine: string;
    engineRuntimeHash: string;
    retirementSink: string;
    retirementSinkRuntimeHash: string;
    rmtToken: string;
    rmtTokenRuntimeHash: string;
    utilityPolicyVersion: number;
    erc20CostPerRecipientAtomic: string;
    erc721CostPerRecipientAtomic: string;
    erc1155CostPerRecipientAtomic: string;
  };
  gasEvidence: Omit<DistributionGasEvidenceV1, "evidenceHash"> & { evidenceHash?: string };
};

const ACTION_STANDARD: Record<DistributionActionKind, DistributionTokenStandard> = {
  erc20_equal: "erc20",
  erc20_custom: "erc20",
  erc721: "erc721",
  erc1155: "erc1155"
};

const CSV_HEADERS: Record<DistributionActionKind, string> = {
  erc20_equal: "recipient",
  erc20_custom: "recipient,amount",
  erc721: "recipient,tokenId",
  erc1155: "recipient,tokenId,amount"
};

const BATCH_DOMAINS: Record<DistributionActionKind, Hex> = {
  erc20_equal: keccak256(toBytes("RMT_DISTRIBUTION_ERC20_EQUAL_BATCH_V1")),
  erc20_custom: keccak256(toBytes("RMT_DISTRIBUTION_ERC20_BATCH_V1")),
  erc721: keccak256(toBytes("RMT_DISTRIBUTION_ERC721_BATCH_V1")),
  erc1155: keccak256(toBytes("RMT_DISTRIBUTION_ERC1155_BATCH_V1"))
};

const GAS_EVIDENCE_DOMAIN = keccak256(toBytes("RMT_DISTRIBUTION_GAS_EVIDENCE_V1"));
const BATCH_ID_DOMAIN = keccak256(toBytes("RMT_DISTRIBUTION_BATCH_ID_V1"));
const ZERO_HASH = `0x${"0".repeat(64)}`;
const DECIMAL = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const ATOMIC = /^(0|[1-9][0-9]*)$/;
const SOURCE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const entrySchema = z.object({
  recipient: z.string(),
  amountAtomic: z.string().nullable(),
  tokenId: z.string().nullable()
}).strict();

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  chainId: z.literal(4_663),
  sender: z.string(),
  actionKind: z.enum(["erc20_equal", "erc20_custom", "erc721", "erc1155"]),
  asset: z.object({ chainId: z.literal(4_663), address: z.string(), standard: z.enum(["erc20", "erc721", "erc1155"]), decimals: z.number().int().nullable() }).strict(),
  entries: z.array(entrySchema).min(1).max(MAX_DISTRIBUTION_ROWS),
  sourceEvidence: z.object({ snapshotBlock: z.string().nullable(), sourceId: z.string().nullable(), evidenceHash: z.string().nullable() }).strict(),
  infrastructure: z.object({
    engine: z.string(), engineRuntimeHash: z.string(), retirementSink: z.string(), retirementSinkRuntimeHash: z.string(),
    rmtToken: z.string(), rmtTokenRuntimeHash: z.string(), utilityPolicyVersion: z.number().int(),
    erc20CostPerRecipientAtomic: z.string(), erc721CostPerRecipientAtomic: z.string(), erc1155CostPerRecipientAtomic: z.string()
  }).strict(),
  gasEvidence: z.object({
    chainId: z.literal(4_663), actionKind: z.enum(["erc20_equal", "erc20_custom", "erc721", "erc1155"]),
    measuredAtBlock: z.string(), blockGasLimit: z.string(), safetyMarginBps: z.number().int(),
    source: z.enum(["foundry_simulation", "fork_simulation"]),
    samples: z.array(z.object({ recipientCount: z.number().int(), gasUsed: z.string() }).strict()).min(1),
    evidenceHash: z.string()
  }).strict(),
  expectedTotalDistributionAtomic: z.string(),
  expectedTotalRmtRetirementAtomic: z.string(),
  manifestHash: z.string(),
  canonicalCsv: z.string(),
  batches: z.array(z.object({
    schemaVersion: z.literal(1), manifestHash: z.string(), batchIndex: z.number().int(), batchId: z.string(),
    batchHash: z.string(), recipientCount: z.number().int(), entries: z.array(entrySchema),
    totalAssetAmountAtomic: z.string(), utilityCostAtomic: z.string(), conservativeGasEstimate: z.string()
  }).strict()).min(1)
}).strict();

function fail(message: string): never {
  throw new Error(`RMT rejected distribution input: ${message}`);
}

function address(value: string, label: string): Address {
  if (!isAddress(value, { strict: false })) fail(`${label} is not a valid EVM address`);
  return getAddress(value);
}

function hash(value: string, label: string): Hex {
  if (!isHash(value) || value.toLowerCase() === ZERO_HASH) fail(`${label} is not a nonzero bytes32 hash`);
  return value.toLowerCase() as Hex;
}

function atomic(value: string, label: string, allowZero = false): bigint {
  if (!ATOMIC.test(value)) fail(`${label} must be a canonical unsigned integer`);
  const parsed = BigInt(value);
  if ((!allowZero && parsed === 0n) || parsed > UINT256_MAX) fail(`${label} is outside uint256 bounds`);
  return parsed;
}

export function parseDistributionDecimal(value: string, decimals: number, label = "amount"): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) fail("asset decimals are invalid");
  const match = DECIMAL.exec(value);
  if (!match) fail(`${label} must use plain canonical decimal notation`);
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) fail(`${label} has more precision than the asset supports`);
  const parsed = BigInt(match[1]) * 10n ** BigInt(decimals)
    + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (parsed === 0n || parsed > UINT256_MAX) fail(`${label} is outside uint256 bounds`);
  return parsed;
}

function normalizeCsv(csv: string): string[] {
  if (csv.length === 0 || csv.charCodeAt(0) === 0xfeff) fail("CSV is empty or contains a byte-order mark");
  if (/\r(?!\n)/.test(csv)) fail("CSV contains an unsupported carriage return");
  const normalized = csv.replaceAll("\r\n", "\n");
  const withoutTerminalNewline = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  const lines = withoutTerminalNewline.split("\n");
  if (lines.some((line) => line.length === 0)) fail("CSV contains an empty row");
  return lines;
}

function validateRecipient(recipient: Address, sender: Address, engine: Address, sink: Address, row: number) {
  if (recipient === getAddress(zeroAddress) || recipient === sender || recipient === engine || recipient === sink) {
    fail(`row ${row} contains a prohibited recipient`);
  }
}

function entrySort(actionKind: DistributionActionKind) {
  return (left: DistributionEntryV1, right: DistributionEntryV1) => {
    if (actionKind === "erc721" || actionKind === "erc1155") {
      const tokenOrder = BigInt(left.tokenId!) < BigInt(right.tokenId!) ? -1 : BigInt(left.tokenId!) > BigInt(right.tokenId!) ? 1 : 0;
      if (tokenOrder !== 0) return tokenOrder;
    }
    return left.recipient.toLowerCase().localeCompare(right.recipient.toLowerCase());
  };
}

export function parseDistributionCsvV1(input: {
  actionKind: DistributionActionKind;
  csv: string;
  decimals: number | null;
  equalAmount?: string;
  sender: string;
  engine: string;
  retirementSink: string;
}) {
  const lines = normalizeCsv(input.csv);
  if (lines[0] !== CSV_HEADERS[input.actionKind]) fail(`CSV header must be exactly '${CSV_HEADERS[input.actionKind]}'`);
  if (lines.length === 1) fail("CSV has no distribution rows");
  if (lines.length - 1 > MAX_DISTRIBUTION_ROWS) fail(`CSV exceeds the ${MAX_DISTRIBUTION_ROWS}-row limit`);

  const sender = address(input.sender, "sender");
  const engine = address(input.engine, "engine");
  const sink = address(input.retirementSink, "retirement sink");
  const isErc20 = input.actionKind === "erc20_equal" || input.actionKind === "erc20_custom";
  if (isErc20 && input.decimals === null) fail("ERC-20 decimals are required");
  if (!isErc20 && input.decimals !== null) fail("NFT decimals must be null");
  const equalAmountAtomic = input.actionKind === "erc20_equal"
    ? parseDistributionDecimal(input.equalAmount ?? "", input.decimals!, "equal amount")
    : null;

  const entries: DistributionEntryV1[] = [];
  const duplicateKeys = new Set<string>();
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const row = lineIndex + 1;
    const rawCells = lines[lineIndex].split(",");
    const expectedCells = CSV_HEADERS[input.actionKind].split(",").length;
    if (rawCells.length !== expectedCells || rawCells.some((cell) => cell.trim() !== cell || cell.includes('"'))) {
      fail(`row ${row} does not match the exact CSV schema`);
    }
    const recipient = address(rawCells[0], `row ${row} recipient`);
    validateRecipient(recipient, sender, engine, sink, row);

    let amountAtomic: string | null = null;
    let tokenId: string | null = null;
    if (input.actionKind === "erc20_equal") {
      amountAtomic = equalAmountAtomic!.toString();
    } else if (input.actionKind === "erc20_custom") {
      amountAtomic = parseDistributionDecimal(rawCells[1], input.decimals!, `row ${row} amount`).toString();
    } else if (input.actionKind === "erc721") {
      tokenId = atomic(rawCells[1], `row ${row} tokenId`, true).toString();
    } else {
      tokenId = atomic(rawCells[1], `row ${row} tokenId`, true).toString();
      amountAtomic = atomic(rawCells[2], `row ${row} amount`).toString();
    }

    const duplicateKey = input.actionKind === "erc721"
      ? `token:${tokenId}`
      : input.actionKind === "erc1155"
        ? `${recipient.toLowerCase()}:${tokenId}`
        : recipient.toLowerCase();
    if (duplicateKeys.has(duplicateKey)) fail(`row ${row} duplicates an earlier distribution identity`);
    duplicateKeys.add(duplicateKey);
    entries.push({ recipient, amountAtomic, tokenId });
  }
  entries.sort(entrySort(input.actionKind));
  return { entries, canonicalCsv: distributionEntriesToCsv(input.actionKind, entries, input.decimals) };
}

export function distributionEntriesToCsv(
  actionKind: DistributionActionKind,
  entries: DistributionEntryV1[],
  decimals: number | null
) {
  const rows = entries.map((entry) => {
    if (actionKind === "erc20_equal") return entry.recipient;
    if (actionKind === "erc20_custom") {
      if (decimals === null) fail("ERC-20 decimals are required for canonical CSV output");
      return `${entry.recipient},${atomicToDecimal(entry.amountAtomic!, decimals)}`;
    }
    if (actionKind === "erc721") return `${entry.recipient},${entry.tokenId}`;
    return `${entry.recipient},${entry.tokenId},${entry.amountAtomic}`;
  });
  return `${CSV_HEADERS[actionKind]}\n${rows.join("\n")}\n`;
}

function canonicalJsonValue(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("canonical JSON contains a non-integer number");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonValue).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJsonValue(record[key])}`).join(",")}}`;
  }
  fail("canonical JSON contains an unsupported value");
}

export function canonicalDistributionJson(value: unknown) {
  return canonicalJsonValue(value);
}

function normalizeInfrastructure(value: BuildDistributionManifestInput["infrastructure"]): DistributionInfrastructureV1 {
  const engine = address(value.engine, "engine");
  const retirementSink = address(value.retirementSink, "retirement sink");
  const rmtToken = address(value.rmtToken, "RMT token");
  if (engine === retirementSink || engine === rmtToken || retirementSink === rmtToken) fail("infrastructure addresses must be distinct");
  if (!Number.isSafeInteger(value.utilityPolicyVersion) || value.utilityPolicyVersion <= 0) fail("utility policy version is invalid");
  return {
    engine,
    engineRuntimeHash: hash(value.engineRuntimeHash, "engine runtime"),
    retirementSink,
    retirementSinkRuntimeHash: hash(value.retirementSinkRuntimeHash, "retirement sink runtime"),
    rmtToken,
    rmtTokenRuntimeHash: hash(value.rmtTokenRuntimeHash, "RMT runtime"),
    utilityPolicyVersion: value.utilityPolicyVersion,
    erc20CostPerRecipientAtomic: atomic(value.erc20CostPerRecipientAtomic, "ERC-20 utility rate").toString(),
    erc721CostPerRecipientAtomic: atomic(value.erc721CostPerRecipientAtomic, "ERC-721 utility rate").toString(),
    erc1155CostPerRecipientAtomic: atomic(value.erc1155CostPerRecipientAtomic, "ERC-1155 utility rate").toString()
  };
}

function gasEvidenceHash(evidence: Omit<DistributionGasEvidenceV1, "evidenceHash">): Hex {
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "uint256" }, { type: "uint8" }, { type: "uint256" }, { type: "uint256" },
      { type: "uint16" }, { type: "string" }, { type: "uint256[]" }, { type: "uint256[]" }
    ],
    [
      GAS_EVIDENCE_DOMAIN,
      BigInt(evidence.chainId),
      actionKindNumber(evidence.actionKind),
      BigInt(evidence.measuredAtBlock),
      BigInt(evidence.blockGasLimit),
      evidence.safetyMarginBps,
      evidence.source,
      evidence.samples.map((sample) => BigInt(sample.recipientCount)),
      evidence.samples.map((sample) => BigInt(sample.gasUsed))
    ]
  ));
}

function normalizeGasEvidence(value: BuildDistributionManifestInput["gasEvidence"], actionKind: DistributionActionKind): DistributionGasEvidenceV1 {
  if (value.chainId !== RMT_DISTRIBUTION_CHAIN_ID || value.actionKind !== actionKind) fail("gas evidence identity is inconsistent");
  if (value.source !== "foundry_simulation" && value.source !== "fork_simulation") fail("gas evidence source is invalid");
  if (!Number.isInteger(value.safetyMarginBps) || value.safetyMarginBps <= 0 || value.safetyMarginBps > 10_000) {
    fail("gas safety margin is invalid");
  }
  const measuredAtBlock = atomic(value.measuredAtBlock, "gas evidence block").toString();
  const blockGasLimit = atomic(value.blockGasLimit, "block gas limit").toString();
  const seen = new Set<number>();
  const samples = value.samples.map((sample) => {
    if (!Number.isSafeInteger(sample.recipientCount) || sample.recipientCount <= 0 || sample.recipientCount > MAX_DISTRIBUTION_ROWS) {
      fail("gas sample recipient count is invalid");
    }
    if (seen.has(sample.recipientCount)) fail("gas evidence contains duplicate recipient counts");
    seen.add(sample.recipientCount);
    return { recipientCount: sample.recipientCount, gasUsed: atomic(sample.gasUsed, "gas sample").toString() };
  }).sort((left, right) => left.recipientCount - right.recipientCount);
  for (let index = 1; index < samples.length; index += 1) {
    if (BigInt(samples[index].gasUsed) < BigInt(samples[index - 1].gasUsed)) fail("gas samples are not monotonic");
  }
  const withoutHash = { chainId: RMT_DISTRIBUTION_CHAIN_ID, actionKind, measuredAtBlock, blockGasLimit, safetyMarginBps: value.safetyMarginBps, source: value.source, samples } as const;
  const computedHash = gasEvidenceHash(withoutHash);
  if (value.evidenceHash && hash(value.evidenceHash, "gas evidence") !== computedHash) fail("gas evidence hash is inconsistent");
  return { ...withoutHash, evidenceHash: computedHash };
}

function utilityRate(actionKind: DistributionActionKind, infrastructure: DistributionInfrastructureV1) {
  if (actionKind === "erc20_equal" || actionKind === "erc20_custom") return BigInt(infrastructure.erc20CostPerRecipientAtomic);
  if (actionKind === "erc721") return BigInt(infrastructure.erc721CostPerRecipientAtomic);
  return BigInt(infrastructure.erc1155CostPerRecipientAtomic);
}

function totalAssetAmount(actionKind: DistributionActionKind, entries: DistributionEntryV1[]) {
  if (actionKind === "erc721") return BigInt(entries.length);
  return entries.reduce((total, entry) => total + BigInt(entry.amountAtomic!), 0n);
}

function safeBatchSize(gasEvidence: DistributionGasEvidenceV1) {
  const ceiling = BigInt(gasEvidence.blockGasLimit) * BigInt(gasEvidence.safetyMarginBps) / 10_000n;
  const safe = gasEvidence.samples.filter((sample) => BigInt(sample.gasUsed) <= ceiling);
  if (safe.length === 0) fail("gas evidence does not prove even one safe recipient");
  return safe.at(-1)!.recipientCount;
}

function conservativeGasEstimate(gasEvidence: DistributionGasEvidenceV1, recipientCount: number) {
  const sample = gasEvidence.samples.find((candidate) => candidate.recipientCount >= recipientCount);
  if (!sample) fail("batch exceeds measured gas evidence");
  return sample.gasUsed;
}

export function actionKindNumber(actionKind: DistributionActionKind): 0 | 1 | 2 | 3 {
  switch (actionKind) {
    case "erc20_equal": return 0;
    case "erc20_custom": return 1;
    case "erc721": return 2;
    case "erc1155": return 3;
    default: return fail("action kind is invalid");
  }
}

export function distributionBatchHash(actionKind: DistributionActionKind, asset: Address, entries: DistributionEntryV1[]): Hex {
  if (entries.length === 0) fail("batch must contain at least one distribution entry");
  const recipients = entries.map((entry) => entry.recipient);
  if (actionKind === "erc20_equal") {
    const amounts = new Set(entries.map((entry) => entry.amountAtomic));
    if (amounts.size !== 1) fail("equal ERC-20 batch has inconsistent amounts");
    return keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "address[]" }, { type: "uint256" }],
      [BATCH_DOMAINS[actionKind], asset, recipients, BigInt(entries[0].amountAtomic!)]
    ));
  }
  if (actionKind === "erc20_custom") {
    return keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "address[]" }, { type: "uint256[]" }],
      [BATCH_DOMAINS[actionKind], asset, recipients, entries.map((entry) => BigInt(entry.amountAtomic!))]
    ));
  }
  if (actionKind === "erc721") {
    return keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "address[]" }, { type: "uint256[]" }],
      [BATCH_DOMAINS[actionKind], asset, recipients, entries.map((entry) => BigInt(entry.tokenId!))]
    ));
  }
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "address" }, { type: "address[]" }, { type: "uint256[]" }, { type: "uint256[]" }],
    [BATCH_DOMAINS[actionKind], asset, recipients, entries.map((entry) => BigInt(entry.tokenId!)), entries.map((entry) => BigInt(entry.amountAtomic!))]
  ));
}

function buildBatches(core: DistributionManifestCoreV1, manifestHash: Hex): DistributionBatchV1[] {
  const maximumRecipients = safeBatchSize(core.gasEvidence);
  const rate = utilityRate(core.actionKind, core.infrastructure);
  const batches: DistributionBatchV1[] = [];
  for (let offset = 0; offset < core.entries.length; offset += maximumRecipients) {
    const entries = core.entries.slice(offset, offset + maximumRecipients);
    const batchIndex = batches.length;
    const batchHash = distributionBatchHash(core.actionKind, core.asset.address, entries);
    const batchId = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }],
      [BATCH_ID_DOMAIN, manifestHash, BigInt(batchIndex), batchHash]
    ));
    const utilityCost = rate * BigInt(entries.length);
    const assetTotal = totalAssetAmount(core.actionKind, entries);
    if (utilityCost > UINT256_MAX || assetTotal > UINT256_MAX) fail("batch total exceeds uint256 bounds");
    batches.push({
      schemaVersion: RMT_DISTRIBUTION_SCHEMA_VERSION,
      manifestHash,
      batchIndex,
      batchId,
      batchHash,
      recipientCount: entries.length,
      entries,
      totalAssetAmountAtomic: assetTotal.toString(),
      utilityCostAtomic: utilityCost.toString(),
      conservativeGasEstimate: conservativeGasEstimate(core.gasEvidence, entries.length)
    });
  }
  return batches;
}

function coreHash(core: DistributionManifestCoreV1): Hex {
  return keccak256(toBytes(canonicalDistributionJson(core)));
}

export function buildDistributionManifestV1(input: BuildDistributionManifestInput): DistributionManifestV1 {
  if (input.asset.chainId !== RMT_DISTRIBUTION_CHAIN_ID) fail("asset chain must be Robinhood Chain 4663");
  if (input.asset.standard !== ACTION_STANDARD[input.actionKind]) fail("action kind does not match token standard");
  const sender = address(input.sender, "sender");
  const infrastructure = normalizeInfrastructure(input.infrastructure);
  const asset: DistributionAssetIdentity = {
    chainId: RMT_DISTRIBUTION_CHAIN_ID,
    address: address(input.asset.address, "asset"),
    standard: input.asset.standard,
    decimals: input.asset.decimals
  };
  const parsed = parseDistributionCsvV1({
    actionKind: input.actionKind,
    csv: input.csv,
    decimals: asset.decimals,
    equalAmount: input.equalAmount,
    sender,
    engine: infrastructure.engine,
    retirementSink: infrastructure.retirementSink
  });
  const gasEvidence = normalizeGasEvidence(input.gasEvidence, input.actionKind);
  const sourceId = input.sourceEvidence?.sourceId ?? null;
  const evidenceHash = input.sourceEvidence?.evidenceHash ?? null;
  if ((sourceId === null) !== (evidenceHash === null)) fail("source ID and evidence hash must be provided together");
  if (sourceId !== null && !SOURCE_ID.test(sourceId)) fail("source ID is invalid");
  const sourceEvidence: DistributionSourceEvidenceV1 = {
    snapshotBlock: input.sourceEvidence?.snapshotBlock === undefined || input.sourceEvidence.snapshotBlock === null
      ? null
      : atomic(input.sourceEvidence.snapshotBlock, "snapshot block", true).toString(),
    sourceId,
    evidenceHash: evidenceHash === null ? null : hash(evidenceHash, "source evidence")
  };
  const expectedTotal = totalAssetAmount(input.actionKind, parsed.entries);
  const expectedRmt = utilityRate(input.actionKind, infrastructure) * BigInt(parsed.entries.length);
  if (expectedTotal > UINT256_MAX || expectedRmt > UINT256_MAX) fail("manifest total exceeds uint256 bounds");
  const core: DistributionManifestCoreV1 = {
    schemaVersion: RMT_DISTRIBUTION_SCHEMA_VERSION,
    chainId: RMT_DISTRIBUTION_CHAIN_ID,
    sender,
    actionKind: input.actionKind,
    asset,
    entries: parsed.entries,
    sourceEvidence,
    infrastructure,
    gasEvidence,
    expectedTotalDistributionAtomic: expectedTotal.toString(),
    expectedTotalRmtRetirementAtomic: expectedRmt.toString()
  };
  const manifestHash = coreHash(core);
  return { ...core, manifestHash, canonicalCsv: parsed.canonicalCsv, batches: buildBatches(core, manifestHash) };
}

export function parseDistributionManifestV1(value: unknown): DistributionManifestV1 {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) fail("manifest schema is malformed");
  const candidate = parsed.data as DistributionManifestV1;
  const rebuilt = buildDistributionManifestV1({
    sender: candidate.sender,
    actionKind: candidate.actionKind,
    asset: candidate.asset,
    csv: candidate.canonicalCsv,
    equalAmount: candidate.actionKind === "erc20_equal"
      ? atomicToDecimal(candidate.entries[0].amountAtomic!, candidate.asset.decimals!)
      : undefined,
    sourceEvidence: candidate.sourceEvidence,
    infrastructure: candidate.infrastructure,
    gasEvidence: candidate.gasEvidence
  });
  if (canonicalDistributionJson(candidate) !== canonicalDistributionJson(rebuilt)) fail("manifest content or deterministic hash is inconsistent");
  return rebuilt;
}

export function atomicToDecimal(value: string, decimals: number) {
  const parsed = atomic(value, "atomic amount", true);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) fail("asset decimals are invalid");
  if (decimals === 0) return parsed.toString();
  const padded = parsed.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

export function pendingDistributionBatches(manifestValue: unknown, settlements: Array<{ manifestHash: string; batchId: string; status: string }>) {
  const manifest = parseDistributionManifestV1(manifestValue);
  const confirmed = new Set<string>();
  for (const settlement of settlements) {
    if (settlement.manifestHash.toLowerCase() !== manifest.manifestHash) fail("settlement belongs to another manifest");
    const batchId = hash(settlement.batchId, "settlement batch ID");
    if (!manifest.batches.some((batch) => batch.batchId === batchId)) fail("settlement references an unknown batch");
    if (settlement.status !== "confirmed") continue;
    if (confirmed.has(batchId)) fail("confirmed batch appears more than once");
    confirmed.add(batchId);
  }
  return manifest.batches.filter((batch) => !confirmed.has(batch.batchId));
}
