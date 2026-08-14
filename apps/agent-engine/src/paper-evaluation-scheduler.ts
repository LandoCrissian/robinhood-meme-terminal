import type { PaperEvaluationResult } from "./paper-evaluation.ts";

export interface PaperEvaluationScheduleCandidate {
  agentId: string;
  accountId: string;
  evaluationIntervalSeconds: number;
}

export interface PaperEvaluationScheduleCatalog {
  listCandidates(): Promise<PaperEvaluationScheduleCandidate[]>;
}

export interface PaperEvaluationExecutor {
  evaluate(input: {
    agentId: string;
    accountId: string;
    evaluationKey: string;
    evaluatedAt?: number;
  }): Promise<PaperEvaluationResult>;
}

export interface PaperEvaluationSchedulerConfig {
  maximumCandidates: number;
  maximumConcurrency: number;
  evaluationKeyPrefix: string;
}

export type PaperEvaluationScheduleResult =
  | { status: "fulfilled"; agentId: string; accountId: string; evaluationKey: string; slotStart: number; result: PaperEvaluationResult }
  | { status: "rejected"; agentId: string; accountId: string; evaluationKey: string; slotStart: number; error: string };

function fail(message: string): never { throw new Error(message); }
function assertNonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be non-empty`);
  return value.trim();
}
function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) fail(`${field} must be a positive integer`);
}
function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function paperEvaluationSlotStart(now: number, evaluationIntervalSeconds: number): number {
  assertTimestamp(now, "scheduler now");
  assertPositiveInteger(evaluationIntervalSeconds, "evaluationIntervalSeconds");
  const intervalMs = evaluationIntervalSeconds * 1_000;
  if (!Number.isSafeInteger(intervalMs)) fail("evaluation interval exceeds safe integer range");
  const slotStart = Math.floor(now / intervalMs) * intervalMs;
  if (!Number.isSafeInteger(slotStart)) fail("evaluation slot exceeds safe integer range");
  return slotStart;
}

export function buildPaperEvaluationKey(input: {
  prefix: string;
  agentId: string;
  accountId: string;
  evaluationIntervalSeconds: number;
  slotStart: number;
}): string {
  const prefix = assertNonEmpty(input.prefix, "evaluationKeyPrefix");
  const agentId = assertNonEmpty(input.agentId, "agentId");
  const accountId = assertNonEmpty(input.accountId, "accountId");
  assertPositiveInteger(input.evaluationIntervalSeconds, "evaluationIntervalSeconds");
  assertTimestamp(input.slotStart, "slotStart");
  return `${prefix}:${agentId}:${accountId}:${input.evaluationIntervalSeconds}:${input.slotStart}`;
}

export class PaperEvaluationScheduler {
  private readonly catalog: PaperEvaluationScheduleCatalog;
  private readonly executor: PaperEvaluationExecutor;
  private readonly config: PaperEvaluationSchedulerConfig;

  constructor(input: { catalog: PaperEvaluationScheduleCatalog; executor: PaperEvaluationExecutor; config: PaperEvaluationSchedulerConfig }) {
    this.catalog = input.catalog;
    this.executor = input.executor;
    this.config = structuredClone(input.config);
    assertPositiveInteger(this.config.maximumCandidates, "maximumCandidates");
    assertPositiveInteger(this.config.maximumConcurrency, "maximumConcurrency");
    if (this.config.maximumConcurrency > 64) fail("maximumConcurrency exceeds 64");
    assertNonEmpty(this.config.evaluationKeyPrefix, "evaluationKeyPrefix");
  }

  async runOnce(now = Date.now()): Promise<PaperEvaluationScheduleResult[]> {
    assertTimestamp(now, "scheduler now");
    const rawCandidates = await this.catalog.listCandidates();
    if (!Array.isArray(rawCandidates)) fail("evaluation schedule catalog must return an array");
    if (rawCandidates.length > this.config.maximumCandidates) fail("evaluation schedule candidate count exceeds policy maximum");

    const candidates = new Map<string, PaperEvaluationScheduleCandidate & { slotStart: number; evaluationKey: string }>();
    for (const candidate of rawCandidates) {
      const agentId = assertNonEmpty(candidate.agentId, "candidate agentId");
      const accountId = assertNonEmpty(candidate.accountId, "candidate accountId");
      assertPositiveInteger(candidate.evaluationIntervalSeconds, "candidate evaluationIntervalSeconds");
      const slotStart = paperEvaluationSlotStart(now, candidate.evaluationIntervalSeconds);
      const evaluationKey = buildPaperEvaluationKey({ prefix: this.config.evaluationKeyPrefix, agentId, accountId, evaluationIntervalSeconds: candidate.evaluationIntervalSeconds, slotStart });
      if (!candidates.has(evaluationKey)) candidates.set(evaluationKey, { agentId, accountId, evaluationIntervalSeconds: candidate.evaluationIntervalSeconds, slotStart, evaluationKey });
    }

    const queue = [...candidates.values()].sort((a, b) => a.evaluationKey.localeCompare(b.evaluationKey));
    const results = new Array<PaperEvaluationScheduleResult>(queue.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(this.config.maximumConcurrency, queue.length) }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= queue.length) return;
        const candidate = queue[index]!;
        try {
          const result = await this.executor.evaluate({ agentId: candidate.agentId, accountId: candidate.accountId, evaluationKey: candidate.evaluationKey, evaluatedAt: now });
          results[index] = { status: "fulfilled", agentId: candidate.agentId, accountId: candidate.accountId, evaluationKey: candidate.evaluationKey, slotStart: candidate.slotStart, result };
        } catch (error) {
          results[index] = { status: "rejected", agentId: candidate.agentId, accountId: candidate.accountId, evaluationKey: candidate.evaluationKey, slotStart: candidate.slotStart, error: errorMessage(error) };
        }
      }
    });
    await Promise.all(workers);
    return results;
  }
}
