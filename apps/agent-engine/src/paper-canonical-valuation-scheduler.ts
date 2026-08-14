import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import {
  PaperCanonicalValuationService,
  assertPaperCanonicalValuationRecord,
  type PaperCanonicalValuationRecord,
} from "./paper-canonical-valuation.ts";
import type { PaperArenaEntryRecord } from "./paper-arena-entry.ts";
import {
  type PaperCanonicalValuationHistoryStore,
} from "./paper-canonical-valuation-store.ts";
import { buildPaperPositionBook } from "./paper-position-book.ts";
import {
  assertRmtPaperQuoteResult,
  type RmtPaperQuoteResult,
} from "./rmt-paper-quote.ts";
import type { AgentStateStore } from "./persistence/store.ts";

export interface PaperCanonicalLiquidationQuoteSourceInput {
  accountId: string;
  inputAssetId: string;
  outputAssetId: string;
  inputAmountAtomic: string;
  observedAtMs: number;
}

export interface PaperCanonicalLiquidationQuoteSource {
  readonly sourceId: string;
  quote(input: PaperCanonicalLiquidationQuoteSourceInput): Promise<RmtPaperQuoteResult>;
}

export interface PaperCanonicalValuationSchedulerConfig {
  cadenceMs: number;
  maximumLatenessMs: number;
  maximumQuoteAgeMs: number;
  maximumOpenPositions: number;
}

export type PaperCanonicalValuationSchedulerResult =
  | {
      status: "NOT_DUE";
      nextDueAt: number;
      observedAt: number;
    }
  | {
      status: "STORED";
      nextDueAt: number;
      observedAt: number;
      valuation: PaperCanonicalValuationRecord;
      historyHash: string;
    };

function fail(message: string): never {
  throw new Error(message);
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${field} must be a positive safe integer`);
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function historyHash(records: PaperCanonicalValuationRecord[]): string {
  return hashCanonicalPayload(records.map((record) => ({
    valuedAt: record.valuation.valuedAt,
    revision: record.revision,
    engineStateHash: record.engineStateHash,
    recordHash: hashCanonicalPayload(record),
  })));
}

export class PaperCanonicalValuationScheduler {
  private readonly stateStore: AgentStateStore;
  private readonly historyStore: PaperCanonicalValuationHistoryStore;
  private readonly quoteSource: PaperCanonicalLiquidationQuoteSource;
  private readonly streamId: string;
  private readonly config: PaperCanonicalValuationSchedulerConfig;
  private readonly valuationService: PaperCanonicalValuationService;

  constructor(input: {
    stateStore: AgentStateStore;
    historyStore: PaperCanonicalValuationHistoryStore;
    quoteSource: PaperCanonicalLiquidationQuoteSource;
    streamId: string;
    config: PaperCanonicalValuationSchedulerConfig;
  }) {
    this.stateStore = input.stateStore;
    this.historyStore = input.historyStore;
    this.quoteSource = input.quoteSource;
    this.streamId = input.streamId;
    this.config = structuredClone(input.config);
    if (typeof this.streamId !== "string" || !this.streamId.trim()) fail("canonical valuation scheduler streamId must be non-empty");
    if (typeof this.quoteSource.sourceId !== "string" || !this.quoteSource.sourceId.trim()) fail("canonical valuation scheduler quote sourceId must be non-empty");
    assertPositiveSafeInteger(this.config.cadenceMs, "canonical valuation cadenceMs");
    if (!Number.isSafeInteger(this.config.maximumLatenessMs) || this.config.maximumLatenessMs < 0) fail("canonical valuation maximumLatenessMs must be a non-negative safe integer");
    assertPositiveSafeInteger(this.config.maximumQuoteAgeMs, "canonical valuation maximumQuoteAgeMs");
    assertPositiveSafeInteger(this.config.maximumOpenPositions, "canonical valuation maximumOpenPositions");
    this.valuationService = new PaperCanonicalValuationService({ store: this.stateStore, streamId: this.streamId });
  }

  async runOnce(input: {
    entry: PaperArenaEntryRecord;
    nowMs?: number;
  }): Promise<PaperCanonicalValuationSchedulerResult> {
    if (input.entry.streamId !== this.streamId) fail("canonical valuation scheduler entry belongs to a different stream");
    const nowMs = input.nowMs ?? Date.now();
    assertTimestamp(nowMs, "canonical valuation scheduler nowMs");
    if (nowMs < input.entry.enteredAt) fail("canonical valuation scheduler now predates Arena entry");

    const history = await this.historyStore.list(this.streamId, input.entry.account.accountId);
    const latest = history[history.length - 1];
    if (latest && latest.valuation.valuedAt > nowMs) fail("canonical valuation history contains a future checkpoint");
    const nextDueAt = (latest?.valuation.valuedAt ?? input.entry.enteredAt) + this.config.cadenceMs;
    if (nowMs < nextDueAt) return { status: "NOT_DUE", nextDueAt, observedAt: nowMs };
    if (nowMs - nextDueAt > this.config.maximumLatenessMs) {
      fail("canonical valuation checkpoint was missed beyond lateness policy; historical backfill is forbidden");
    }

    const state = await this.stateStore.load(this.streamId);
    if (!state) fail("canonical valuation scheduler requires persisted engine state");
    const stateHash = hashCanonicalPayload(state.snapshot);
    const accounts = state.snapshot.paperAccounts.filter((account) => account.accountId === input.entry.account.accountId);
    if (accounts.length !== 1) fail("canonical valuation scheduler requires exactly one current account");
    const account = accounts[0]!;
    if (account.participantType !== input.entry.participantType || account.participantId !== input.entry.participantId) {
      fail("canonical valuation scheduler current participant differs from Arena entry");
    }
    if (account.seasonId !== input.entry.season.seasonId) fail("canonical valuation scheduler current season differs from Arena entry");

    const positionBook = buildPaperPositionBook({
      accountId: account.accountId,
      quoteAssetId: input.entry.quoteAssetId,
      fills: state.snapshot.paperFills.filter((fill) => fill.accountId === account.accountId),
    });
    const openPositions = positionBook.positions.filter((position) => BigInt(position.quantityAtomic) > 0n);
    if (openPositions.length > this.config.maximumOpenPositions) fail("canonical valuation open-position count exceeds scheduler policy");

    const quoteResults = await Promise.all(openPositions.map(async (position) => {
      const quote = await this.quoteSource.quote({
        accountId: account.accountId,
        inputAssetId: position.assetId,
        outputAssetId: input.entry.quoteAssetId,
        inputAmountAtomic: position.quantityAtomic,
        observedAtMs: nowMs,
      });
      assertRmtPaperQuoteResult(quote);
      if (
        quote.evidence.inputAssetId !== position.assetId
        || quote.evidence.outputAssetId !== input.entry.quoteAssetId
        || quote.evidence.inputAmountAtomic !== position.quantityAtomic
      ) fail("canonical valuation quote source returned evidence for a different full position");
      return quote;
    }));

    const valuation = await this.valuationService.value({
      accountId: account.accountId,
      quoteAssetId: input.entry.quoteAssetId,
      quoteResults,
      valuedAt: nowMs,
      maximumQuoteAgeMs: this.config.maximumQuoteAgeMs,
    });
    assertPaperCanonicalValuationRecord(valuation);
    if (valuation.revision !== state.revision || valuation.engineStateHash !== stateHash) {
      fail("canonical valuation paper state changed while checkpoint was being quoted");
    }
    const stored = await this.historyStore.put(valuation);
    const updatedHistory = [...history, stored].sort((left, right) => left.valuation.valuedAt - right.valuation.valuedAt);
    return {
      status: "STORED",
      nextDueAt: stored.valuation.valuedAt + this.config.cadenceMs,
      observedAt: nowMs,
      valuation: stored,
      historyHash: historyHash(updatedHistory),
    };
  }
}
