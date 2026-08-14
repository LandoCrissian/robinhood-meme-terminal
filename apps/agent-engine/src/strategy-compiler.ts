import { randomUUID } from "node:crypto";
import {
  assertCompiledStrategyAdmissible,
  assertStrategyCompilerPolicy,
  buildStrategyCompilationRequestHash,
  hardenStrategySpec,
  hashCanonicalPayload,
  hashStrategyCompilationPayload,
  normalizeStrategyThesis,
  parseStrategyModelDraft,
  type AgentSafetyEnvelope,
  type StrategyCompilationRecord,
  type StrategyCompilerPolicy,
  type StrategyModelDraft,
} from "../../../packages/agent-core/src/index.ts";

export interface StrategyModelAdapterInput {
  thesis: string;
  strategySchemaVersion: 1;
  safetyEnvelope: AgentSafetyEnvelope;
  compilerPolicy: StrategyCompilerPolicy;
  outputInstruction: "STRUCTURED_STRATEGY_DRAFT_ONLY";
}

export interface StrategyModelAdapter {
  readonly adapterId: string;
  readonly modelIdentity: string;
  compile(input: StrategyModelAdapterInput): Promise<unknown>;
}

export interface StrategyCompilerConfig {
  safetyEnvelope: AgentSafetyEnvelope;
  policy: StrategyCompilerPolicy;
}

export interface StrategyCompileInput {
  agentId: string;
  thesis: string;
  compiledAt?: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeModelOutputHash(value: unknown): string {
  try {
    return hashCanonicalPayload(value);
  } catch {
    return hashCanonicalPayload({ unhashableModelOutputType: Object.prototype.toString.call(value) });
  }
}

export class StrategyCompiler {
  private readonly config: StrategyCompilerConfig;
  private readonly adapter: StrategyModelAdapter;

  constructor(config: StrategyCompilerConfig, adapter: StrategyModelAdapter) {
    this.config = clone(config);
    this.adapter = adapter;
    assertStrategyCompilerPolicy(this.config.policy);
    if (typeof this.adapter.adapterId !== "string" || !this.adapter.adapterId.trim()) throw new Error("strategy adapterId must be non-empty");
    if (typeof this.adapter.modelIdentity !== "string" || !this.adapter.modelIdentity.trim()) throw new Error("strategy modelIdentity must be non-empty");
  }

  getRequestHash(input: Pick<StrategyCompileInput, "agentId" | "thesis">): string {
    return buildStrategyCompilationRequestHash({
      agentId: input.agentId,
      thesis: input.thesis,
      safetyEnvelope: this.config.safetyEnvelope,
      policy: this.config.policy,
      adapterId: this.adapter.adapterId,
      modelIdentity: this.adapter.modelIdentity,
    });
  }

  async compile(input: StrategyCompileInput): Promise<StrategyCompilationRecord> {
    const compiledAt = input.compiledAt ?? Date.now();
    assertTimestamp(compiledAt, "compiledAt");
    const normalizedThesis = normalizeStrategyThesis(input.thesis);
    if (normalizedThesis.length > this.config.policy.maximumThesisChars) throw new Error("strategy thesis exceeds compiler policy maximum");
    const requestHash = this.getRequestHash({ agentId: input.agentId, thesis: normalizedThesis });
    const thesisHash = hashCanonicalPayload(normalizedThesis);

    const rawOutput = await this.adapter.compile({
      thesis: normalizedThesis,
      strategySchemaVersion: 1,
      safetyEnvelope: clone(this.config.safetyEnvelope),
      compilerPolicy: clone(this.config.policy),
      outputInstruction: "STRUCTURED_STRATEGY_DRAFT_ONLY",
    });
    const modelOutputHash = safeModelOutputHash(rawOutput);

    let draft: StrategyModelDraft | undefined;
    let admittedSpec: StrategyModelDraft["spec"] | undefined;
    const errors: string[] = [];
    try {
      draft = parseStrategyModelDraft(rawOutput);
      admittedSpec = hardenStrategySpec(draft.spec, this.config.policy);
      assertCompiledStrategyAdmissible(admittedSpec, this.config.safetyEnvelope, this.config.policy);
    } catch (error) {
      errors.push(errorMessage(error));
    }

    const status = errors.length === 0 ? "ADMITTED" as const : "REJECTED" as const;
    const candidateSpec = draft?.spec ? clone(draft.spec) : undefined;
    const payload: Omit<StrategyCompilationRecord, "compilationHash"> = {
      compilationId: randomUUID(),
      requestHash,
      agentId: input.agentId,
      normalizedThesis,
      thesisHash,
      status,
      compilerVersion: this.config.policy.compilerVersion,
      policyVersion: this.config.policy.policyVersion,
      adapterId: this.adapter.adapterId,
      modelIdentity: this.adapter.modelIdentity,
      modelOutputHash,
      candidateSpec,
      candidateSpecHash: candidateSpec ? hashCanonicalPayload(candidateSpec) : undefined,
      admittedSpec: status === "ADMITTED" && admittedSpec ? clone(admittedSpec) : undefined,
      admittedSpecHash: status === "ADMITTED" && admittedSpec ? hashCanonicalPayload(admittedSpec) : undefined,
      summary: draft?.summary ?? "Strategy compilation rejected before a valid structured draft was admitted.",
      assumptions: draft?.assumptions ?? [],
      warnings: draft?.warnings ?? [],
      errors,
      compiledAt,
    };
    return { ...payload, compilationHash: hashStrategyCompilationPayload(payload) };
  }
}
