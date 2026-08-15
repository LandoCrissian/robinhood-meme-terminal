import {
  PaperCanonicalRiskSnapshotService,
  assertPaperCanonicalRiskSnapshotRecord,
  type PaperCanonicalRiskSnapshotRecord,
} from "./paper-canonical-risk-snapshot.ts";
import type { PaperArenaEntryRecord } from "./paper-arena-entry.ts";
import type { PaperCanonicalValuationRecord } from "./paper-canonical-valuation.ts";
import type { AgentStateStore } from "./persistence/store.ts";

export type HumanCanonicalRiskSnapshotRecord = PaperCanonicalRiskSnapshotRecord;

function fail(message: string): never {
  throw new Error(message);
}

export function assertHumanCanonicalRiskSnapshotRecord(record: HumanCanonicalRiskSnapshotRecord): void {
  assertPaperCanonicalRiskSnapshotRecord(record);
  if (record.entry.participantType !== "HUMAN") fail("human canonical risk requires a HUMAN Arena entry");
  if (record.snapshot.accountId !== record.entry.account.accountId) fail("human canonical risk snapshot account mismatch");
}

export class HumanCanonicalRiskSnapshotService {
  private readonly canonical: PaperCanonicalRiskSnapshotService;

  constructor(input: { store: AgentStateStore; streamId: string; rollingTradeWindowMs?: number }) {
    this.canonical = new PaperCanonicalRiskSnapshotService({
      store: input.store,
      streamId: input.streamId,
      participantType: "HUMAN",
      rollingTradeWindowMs: input.rollingTradeWindowMs,
    });
  }

  async derive(input: {
    entry: PaperArenaEntryRecord;
    valuations: PaperCanonicalValuationRecord[];
    positionAssetId: string;
  }): Promise<HumanCanonicalRiskSnapshotRecord> {
    const record = await this.canonical.derive(input);
    assertHumanCanonicalRiskSnapshotRecord(record);
    return record;
  }
}
