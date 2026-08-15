import {
  PaperCanonicalRiskSnapshotService,
  assertPaperCanonicalRiskSnapshotRecord,
  type PaperCanonicalRiskSnapshotRecord,
} from "./paper-canonical-risk-snapshot.ts";
import type { PaperArenaEntryRecord } from "./paper-arena-entry.ts";
import type { PaperCanonicalValuationRecord } from "./paper-canonical-valuation.ts";
import type { AgentStateStore } from "./persistence/store.ts";

export type AgentCanonicalRiskSnapshotRecord = PaperCanonicalRiskSnapshotRecord;

function fail(message: string): never {
  throw new Error(message);
}

export function assertAgentCanonicalRiskSnapshotRecord(record: AgentCanonicalRiskSnapshotRecord): void {
  assertPaperCanonicalRiskSnapshotRecord(record);
  if (record.entry.participantType !== "AGENT") fail("agent canonical risk requires an AGENT Arena entry");
  if (record.snapshot.accountId !== record.entry.account.accountId) fail("agent canonical risk snapshot account mismatch");
}

export class AgentCanonicalRiskSnapshotService {
  private readonly canonical: PaperCanonicalRiskSnapshotService;

  constructor(input: { store: AgentStateStore; streamId: string; rollingTradeWindowMs?: number }) {
    this.canonical = new PaperCanonicalRiskSnapshotService({
      store: input.store,
      streamId: input.streamId,
      participantType: "AGENT",
      rollingTradeWindowMs: input.rollingTradeWindowMs,
    });
  }

  async derive(input: {
    entry: PaperArenaEntryRecord;
    valuations: PaperCanonicalValuationRecord[];
    positionAssetId: string;
  }): Promise<AgentCanonicalRiskSnapshotRecord> {
    const record = await this.canonical.derive(input);
    assertAgentCanonicalRiskSnapshotRecord(record);
    return record;
  }
}
