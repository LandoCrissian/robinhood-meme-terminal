import { hashCanonicalPayload } from "./canonical.ts";
import {
  assertNonEmptyString,
  assertPositiveInteger,
  assertSafetyEnvelope,
  assertStrategySpec,
  assertStrategyWithinSafetyEnvelope,
  type AgentSafetyEnvelope,
  type AssetClass,
  type StrategySpec,
} from "./schema.ts";

export type StrategyCompilationStatus = "ADMITTED" | "REJECTED";

export interface StrategyCompilerPolicy {
  schemaVersion: 1;
  compilerVersion: string;
  policyVersion: string;
  maximumThesisChars: number;
  allowedAssetClasses: AssetClass[];
  maximumAssetsPerList: number;
  maximumSignals: number;
  maximumSignalParameters: number;
  requiredProhibitedActions: string[];
}

export interface StrategyModelDraft {
  spec: StrategySpec;
  summary: string;
  assumptions: string[];
  warnings: string[];
}

export interface StrategyCompilationRecord {
  compilationId: string;
  requestHash: string;
  agentId: string;
  normalizedThesis: string;
  thesisHash: string;
  status: StrategyCompilationStatus;
  compilerVersion: string;
  policyVersion: string;
  adapterId: string;
  modelIdentity: string;
  modelOutputHash: string;
  candidateSpec?: StrategySpec;
  candidateSpecHash?: string;
  admittedSpec?: StrategySpec;
  admittedSpecHash?: string;
  summary: string;
  assumptions: string[];
  warnings: string[];
  errors: string[];
  compiledAt: number;
  compilationHash: string;
}

export interface StrategyCompilationFingerprintInput {
  agentId: string;
  thesis: string;
  safetyEnvelope: AgentSafetyEnvelope;
  policy: StrategyCompilerPolicy;
  adapterId: string;
  modelIdentity: string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function readBoundedString(value: unknown, field: string, maximumChars: number): string {
  if (typeof value !== "string") fail(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized) fail(`${field} must be non-empty`);
  if (normalized.length > maximumChars) fail(`${field} exceeds ${maximumChars} characters`);
  return normalized;
}

function readStringList(value: unknown, field: string, maximumItems: number, maximumChars: number): string[] {
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  if (value.length > maximumItems) fail(`${field} exceeds ${maximumItems} items`);
  return value.map((entry, index) => readBoundedString(entry, `${field}[${index}]`, maximumChars));
}

function normalizeUniqueStrings(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  normalized.sort((a, b) => a.localeCompare(b));
  return normalized;
}

function normalizeProhibitedActions(values: string[]): string[] {
  const normalized = [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))];
  normalized.sort((a, b) => a.localeCompare(b));
  return normalized;
}

export function normalizeStrategyThesis(thesis: string): string {
  assertNonEmptyString(thesis, "strategy thesis");
  return thesis.trim().replace(/\s+/g, " ");
}

export function assertStrategyCompilerPolicy(policy: StrategyCompilerPolicy): void {
  if (policy.schemaVersion !== 1) fail("unsupported strategy compiler policy version");
  assertNonEmptyString(policy.compilerVersion, "compilerVersion");
  assertNonEmptyString(policy.policyVersion, "policyVersion");
  assertPositiveInteger(policy.maximumThesisChars, "maximumThesisChars");
  assertPositiveInteger(policy.maximumAssetsPerList, "maximumAssetsPerList");
  assertPositiveInteger(policy.maximumSignals, "maximumSignals");
  assertPositiveInteger(policy.maximumSignalParameters, "maximumSignalParameters");
  if (policy.allowedAssetClasses.length === 0) fail("compiler policy requires at least one allowed asset class");
  const allowed = new Set<AssetClass>();
  for (const assetClass of policy.allowedAssetClasses) {
    if (assetClass !== "RWA" && assetClass !== "COMMUNITY") fail(`unsupported compiler asset class: ${assetClass}`);
    if (allowed.has(assetClass)) fail(`duplicate compiler asset class: ${assetClass}`);
    allowed.add(assetClass);
  }
  if (policy.requiredProhibitedActions.length === 0) fail("compiler policy requires at least one prohibited action");
  const required = normalizeProhibitedActions(policy.requiredProhibitedActions);
  if (required.length !== policy.requiredProhibitedActions.length) fail("requiredProhibitedActions must be non-empty and unique");
}

export function parseStrategyModelDraft(value: unknown): StrategyModelDraft {
  if (!isRecord(value)) fail("strategy model output must be an object");
  if (!isRecord(value.spec)) fail("strategy model output spec must be an object");
  let spec: StrategySpec;
  try {
    assertStrategySpec(value.spec as StrategySpec);
    spec = clone(value.spec as StrategySpec);
  } catch (error) {
    throw new Error(`strategy model output spec is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const [listName, assets] of [
    ["includeAssets", spec.universe.includeAssets],
    ["excludeAssets", spec.universe.excludeAssets],
  ] as const) {
    if (!assets) continue;
    if (!Array.isArray(assets)) fail(`${listName} must be an array`);
    for (const [index, asset] of assets.entries()) readBoundedString(asset, `${listName}[${index}]`, 256);
  }

  for (const [index, signal] of spec.signals.entries()) {
    if (signal.parameters === undefined) continue;
    if (!isRecord(signal.parameters)) fail(`signals[${index}].parameters must be an object`);
    for (const [key, parameter] of Object.entries(signal.parameters)) {
      readBoundedString(key, `signals[${index}].parameters key`, 128);
      const type = typeof parameter;
      if (type !== "string" && type !== "number" && type !== "boolean") fail(`signals[${index}].parameters.${key} has unsupported type`);
      if (type === "number" && !Number.isFinite(parameter as number)) fail(`signals[${index}].parameters.${key} must be finite`);
    }
  }

  return {
    spec,
    summary: readBoundedString(value.summary, "strategy summary", 1_024),
    assumptions: readStringList(value.assumptions, "strategy assumptions", 16, 512),
    warnings: readStringList(value.warnings, "strategy warnings", 16, 512),
  };
}

export function hardenStrategySpec(candidate: StrategySpec, policy: StrategyCompilerPolicy): StrategySpec {
  assertStrategyCompilerPolicy(policy);
  const hardened = clone(candidate);
  hardened.universe.assetClasses = [...new Set(hardened.universe.assetClasses)].sort() as AssetClass[];
  hardened.universe.includeAssets = normalizeUniqueStrings(hardened.universe.includeAssets);
  hardened.universe.excludeAssets = normalizeUniqueStrings(hardened.universe.excludeAssets);
  hardened.signals = hardened.signals.map((signal) => ({
    ...signal,
    type: signal.type.trim(),
    parameters: signal.parameters ? Object.fromEntries(Object.entries(signal.parameters).sort(([a], [b]) => a.localeCompare(b))) : undefined,
  }));
  hardened.prohibitedActions = normalizeProhibitedActions([
    ...hardened.prohibitedActions,
    ...policy.requiredProhibitedActions,
  ]);
  return hardened;
}

export function assertCompiledStrategyAdmissible(
  spec: StrategySpec,
  safetyEnvelope: AgentSafetyEnvelope,
  policy: StrategyCompilerPolicy,
): void {
  assertStrategyCompilerPolicy(policy);
  assertSafetyEnvelope(safetyEnvelope);
  assertStrategyWithinSafetyEnvelope(spec, safetyEnvelope);

  const allowed = new Set(policy.allowedAssetClasses);
  for (const assetClass of spec.universe.assetClasses) {
    if (!allowed.has(assetClass)) fail(`asset class ${assetClass} is not admitted by compiler policy`);
  }
  const includeAssets = spec.universe.includeAssets ?? [];
  const excludeAssets = spec.universe.excludeAssets ?? [];
  if (includeAssets.length > policy.maximumAssetsPerList) fail("includeAssets exceeds compiler policy maximum");
  if (excludeAssets.length > policy.maximumAssetsPerList) fail("excludeAssets exceeds compiler policy maximum");
  const includeKeys = new Set(includeAssets.map((asset) => asset.toLowerCase()));
  for (const asset of excludeAssets) {
    if (includeKeys.has(asset.toLowerCase())) fail(`asset appears in both includeAssets and excludeAssets: ${asset}`);
  }
  if (spec.signals.length > policy.maximumSignals) fail("strategy signal count exceeds compiler policy maximum");
  for (const [index, signal] of spec.signals.entries()) {
    if (Object.keys(signal.parameters ?? {}).length > policy.maximumSignalParameters) {
      fail(`signals[${index}] parameter count exceeds compiler policy maximum`);
    }
  }
  const prohibited = new Set(normalizeProhibitedActions(spec.prohibitedActions));
  for (const action of normalizeProhibitedActions(policy.requiredProhibitedActions)) {
    if (!prohibited.has(action)) fail(`compiled strategy is missing required prohibition: ${action}`);
  }
}

export function buildStrategyCompilationRequestHash(input: StrategyCompilationFingerprintInput): string {
  assertNonEmptyString(input.agentId, "agentId");
  assertNonEmptyString(input.adapterId, "adapterId");
  assertNonEmptyString(input.modelIdentity, "modelIdentity");
  assertStrategyCompilerPolicy(input.policy);
  assertSafetyEnvelope(input.safetyEnvelope);
  const normalizedThesis = normalizeStrategyThesis(input.thesis);
  if (normalizedThesis.length > input.policy.maximumThesisChars) fail("strategy thesis exceeds compiler policy maximum");
  return hashCanonicalPayload({
    schemaVersion: 1,
    agentId: input.agentId,
    normalizedThesis,
    safetyEnvelope: input.safetyEnvelope,
    policy: input.policy,
    adapterId: input.adapterId,
    modelIdentity: input.modelIdentity,
  });
}

export function hashStrategyCompilationPayload(record: Omit<StrategyCompilationRecord, "compilationHash">): string {
  return hashCanonicalPayload(record);
}

export function assertStrategyCompilationRecord(record: StrategyCompilationRecord): void {
  assertNonEmptyString(record.compilationId, "compilationId");
  assertNonEmptyString(record.agentId, "compilation agentId");
  assertNonEmptyString(record.normalizedThesis, "compilation normalizedThesis");
  assertNonEmptyString(record.compilerVersion, "compilation compilerVersion");
  assertNonEmptyString(record.policyVersion, "compilation policyVersion");
  assertNonEmptyString(record.adapterId, "compilation adapterId");
  assertNonEmptyString(record.modelIdentity, "compilation modelIdentity");
  assertNonEmptyString(record.summary, "compilation summary");
  assertHash(record.requestHash, "compilation requestHash");
  assertHash(record.thesisHash, "compilation thesisHash");
  assertHash(record.modelOutputHash, "compilation modelOutputHash");
  assertHash(record.compilationHash, "compilationHash");
  if (!Number.isSafeInteger(record.compiledAt) || record.compiledAt < 0) fail("compiledAt must be a non-negative safe integer");
  if (record.status !== "ADMITTED" && record.status !== "REJECTED") fail("unsupported compilation status");
  if (!Array.isArray(record.assumptions) || !Array.isArray(record.warnings) || !Array.isArray(record.errors)) fail("compilation message fields must be arrays");
  if (record.candidateSpec) {
    assertStrategySpec(record.candidateSpec);
    if (!record.candidateSpecHash) fail("candidateSpecHash is required when candidateSpec exists");
    assertHash(record.candidateSpecHash, "candidateSpecHash");
    if (record.candidateSpecHash !== hashCanonicalPayload(record.candidateSpec)) fail("candidate strategy hash mismatch");
  } else if (record.candidateSpecHash) {
    fail("candidateSpecHash cannot exist without candidateSpec");
  }
  if (record.status === "ADMITTED") {
    if (!record.admittedSpec || !record.admittedSpecHash) fail("admitted compilation requires admitted strategy");
    assertStrategySpec(record.admittedSpec);
    assertHash(record.admittedSpecHash, "admittedSpecHash");
    if (record.admittedSpecHash !== hashCanonicalPayload(record.admittedSpec)) fail("admitted strategy hash mismatch");
    if (record.errors.length !== 0) fail("admitted compilation cannot contain errors");
  } else if (record.admittedSpec || record.admittedSpecHash) {
    fail("rejected compilation cannot contain admitted strategy");
  }
  const { compilationHash, ...payload } = record;
  if (compilationHash !== hashStrategyCompilationPayload(payload)) fail("strategy compilation hash mismatch");
}
