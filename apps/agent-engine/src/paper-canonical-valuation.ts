import {
  assertNonEmptyString,
  hashCanonicalPayload,
  type PaperAccountRecord,
} from "../../../packages/agent-core/src/index.ts";
import type { AgentEngineSnapshot } from "./snapshot.ts";
import {
  buildPaperLiquidationValuation,
  assertPaperLiquidationValuationRecord,
  type PaperLiquidationValuationRecord,
} from "./paper-liquidation-valuation.ts";
import { buildPaperPositionBook } from "./paper-position-book.ts";
import type { AgentStateStore } from "./persistence/store.ts";
import type { RmtPaperQuoteResult } from "./rmt-paper-quote.ts";

export interface PaperCanonicalValuationRecord {
  schemaVersion: 1;
  streamId: string;
  revision: number;
  engineSnapshot: AgentEngineSnapshot;
  engineStateHash: string;
  valuation: PaperLiquidationValuationRecord;
  recordHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail("paper canonical valuation revision must be a positive safe integer");
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function canonicalAccount(snapshot: AgentEngineSnapshot, accountId: string): PaperAccountRecord {
  const matches = snapshot.paperAccounts.filter((account) => account.accountId === accountId);
  if (matches.length !== 1) fail("paper canonical valuation requires exactly one account in engine snapshot");
  return matches[0]!;
}

function assertValuationMatchesSnapshot(record: PaperCanonicalValuationRecord): void {
  const account = canonicalAccount(record.engineSnapshot, record.valuation.accountId);
  if (hashCanonicalPayload(account) !== hashCanonicalPayload(record.valuation.accountSnapshot)) {
    fail("paper canonical valuation account differs from engine snapshot");
  }
  const fills = record.engineSnapshot.paperFills.filter((fill) => fill.accountId === account.accountId);
  const book = buildPaperPositionBook({
    accountId: account.accountId,
    quoteAssetId: record.valuation.quoteAssetId,
    fills,
  });
  if (book.bookHash !== record.valuation.positionBook.bookHash) {
    fail("paper canonical valuation position book differs from engine fills");
  }
}

export function assertPaperCanonicalValuationRecord(record: PaperCanonicalValuationRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported paper canonical valuation schema version");
  assertNonEmptyString(record.streamId, "paper canonical valuation streamId");
  assertRevision(record.revision);
  if (record.engineSnapshot.schemaVersion !== 1) fail("paper canonical valuation engine snapshot version is unsupported");
  assertHash(record.engineStateHash, "paper canonical valuation engineStateHash");
  if (record.engineStateHash !== hashCanonicalPayload(record.engineSnapshot)) fail("paper canonical valuation engine state hash mismatch");
  assertPaperLiquidationValuationRecord(record.valuation);
  assertValuationMatchesSnapshot(record);
  assertHash(record.recordHash, "paper canonical valuation recordHash");
  const { recordHash, ...payload } = record;
  if (recordHash !== hashCanonicalPayload(payload)) fail("paper canonical valuation record hash mismatch");
}

export class PaperCanonicalValuationService {
  private readonly store: AgentStateStore;
  private readonly streamId: string;

  constructor(input: { store: AgentStateStore; streamId: string }) {
    this.store = input.store;
    assertNonEmptyString(input.streamId, "paper canonical valuation streamId");
    this.streamId = input.streamId;
  }

  async value(input: {
    accountId: string;
    quoteAssetId: string;
    quoteResults: RmtPaperQuoteResult[];
    valuedAt?: number;
    maximumQuoteAgeMs: number;
  }): Promise<PaperCanonicalValuationRecord> {
    assertNonEmptyString(input.accountId, "paper canonical valuation accountId");
    assertNonEmptyString(input.quoteAssetId, "paper canonical valuation quoteAssetId");
    const state = await this.store.load(this.streamId);
    if (!state) fail("paper canonical valuation requires persisted engine state");
    assertRevision(state.revision);
    const snapshot = structuredClone(state.snapshot);
    const account = structuredClone(canonicalAccount(snapshot, input.accountId));
    const fills = snapshot.paperFills.filter((fill) => fill.accountId === account.accountId);
    const positionBook = buildPaperPositionBook({
      accountId: account.accountId,
      quoteAssetId: input.quoteAssetId,
      fills,
    });
    const valuation = buildPaperLiquidationValuation({
      positionBook,
      account,
      quoteResults: input.quoteResults,
      valuedAt: input.valuedAt,
      maximumQuoteAgeMs: input.maximumQuoteAgeMs,
    });
    const payload: Omit<PaperCanonicalValuationRecord, "recordHash"> = {
      schemaVersion: 1,
      streamId: this.streamId,
      revision: state.revision,
      engineSnapshot: snapshot,
      engineStateHash: hashCanonicalPayload(snapshot),
      valuation,
    };
    const record: PaperCanonicalValuationRecord = { ...payload, recordHash: hashCanonicalPayload(payload) };
    assertPaperCanonicalValuationRecord(record);
    return record;
  }
}
