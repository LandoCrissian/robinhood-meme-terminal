import type {
  AgentRecord,
  StrategyCompilationRecord,
  StrategyVersionRecord,
} from "../../../packages/agent-core/src/index.ts";
import { StrategyCompiler } from "./strategy-compiler.ts";
import type { StrategyCompilationStore } from "./strategy-compilation-store.ts";

export interface StrategyAdmissionWriter {
  getAgentSummary(agentId: string): { agent: AgentRecord; latestStrategy?: StrategyVersionRecord };
  createStrategyVersion(
    agentId: string,
    spec: NonNullable<StrategyCompilationRecord["admittedSpec"]>,
    idempotencyKey: string,
    createdAt?: number,
  ): Promise<StrategyVersionRecord>;
}

export interface StrategyAdmissionResult {
  compilation: StrategyCompilationRecord;
  strategy?: StrategyVersionRecord;
}

export class StrategyAdmissionService {
  private readonly streamId: string;
  private readonly compiler: StrategyCompiler;
  private readonly store: StrategyCompilationStore;
  private readonly writer: StrategyAdmissionWriter;

  constructor(input: {
    streamId: string;
    compiler: StrategyCompiler;
    store: StrategyCompilationStore;
    writer: StrategyAdmissionWriter;
  }) {
    if (typeof input.streamId !== "string" || input.streamId.trim().length === 0) throw new Error("streamId must be non-empty");
    this.streamId = input.streamId;
    this.compiler = input.compiler;
    this.store = input.store;
    this.writer = input.writer;
  }

  async compileAndAdmit(agentId: string, compiledAt?: number): Promise<StrategyAdmissionResult> {
    const agent = this.writer.getAgentSummary(agentId).agent;
    if (agent.id !== agentId) throw new Error("strategy admission writer returned mismatched agent");
    if (agent.executionMode !== "PAPER_ONLY") throw new Error("strategy compiler foundation only admits PAPER_ONLY agents");

    const requestHash = this.compiler.getRequestHash({ agentId, thesis: agent.thesis });
    let compilation = await this.store.getByRequestHash(this.streamId, requestHash);
    if (!compilation) {
      const proposed = await this.compiler.compile({ agentId, thesis: agent.thesis, compiledAt });
      if (proposed.requestHash !== requestHash) throw new Error("strategy compiler request hash changed during compilation");
      compilation = await this.store.putIfAbsent(this.streamId, proposed);
    }

    if (compilation.agentId !== agentId || compilation.requestHash !== requestHash) {
      throw new Error("stored strategy compilation does not match admission request");
    }
    if (compilation.status === "REJECTED") return { compilation };
    if (!compilation.admittedSpec) throw new Error("admitted strategy compilation is missing admitted spec");

    const strategy = await this.writer.createStrategyVersion(
      agentId,
      compilation.admittedSpec,
      `strategy-admission:${compilation.requestHash}`,
      compilation.compiledAt,
    );
    return { compilation, strategy };
  }
}
