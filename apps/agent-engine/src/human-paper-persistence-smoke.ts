import assert from "node:assert/strict";
import { hashCanonicalPayload, hashPaperQuoteEvidence } from "../../../packages/agent-core/src/index.ts";
import { emptyAgentEngineSnapshot } from "./snapshot.ts";
import { PostgresAgentStateStore, type SqlClientLike, type SqlPoolLike } from "./persistence/postgres-store.ts";
import { agentEngineSchemaSql } from "./persistence/schema.ts";

class RecordingClient implements SqlClientLike {
  readonly calls: Array<{ text: string; values?: unknown[] }> = [];
  async query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: Row[] }> {
    this.calls.push({ text, values: values ? structuredClone(values) : undefined });
    if (text.includes("FROM agent_engine_state")) return { rows: [] as Row[] };
    if (text.includes("FROM agent_engine_mutations")) return { rows: [] as Row[] };
    return { rows: [] as Row[] };
  }
  release(): void {}
}
class RecordingPool implements SqlPoolLike {
  readonly client = new RecordingClient();
  async connect(): Promise<RecordingClient> { return this.client; }
}

const streamId = "human-projector";
const wallet = "0x00000000000000000000000000000000000000aa";
const snapshot = emptyAgentEngineSnapshot();
snapshot.seasons = [{ seasonId: "season-1", name: "Human", startsAt: 1_000, endsAt: 20_000, createdAt: 900 }];
snapshot.paperAccounts = [{
  accountId: "human-account",
  seasonId: "season-1",
  participantType: "HUMAN",
  participantId: wallet,
  balances: { USDG: "800", NVDA: "490" },
  openedAt: 1_100,
}];
snapshot.paperOrders = [{
  orderId: "human-order",
  status: "FILLED",
  participantType: "HUMAN",
  participantId: wallet,
  manualPolicyVersion: "RMT_HUMAN_MANUAL_V1",
  accountId: "human-account",
  inputAssetId: "USDG",
  outputAssetId: "NVDA",
  inputAmountAtomic: "200",
  maximumSlippageBps: 50,
  createdAt: 2_000,
}];
const evidencePayload = {
  quoteId: "quote-1",
  inputAssetId: "USDG",
  outputAssetId: "NVDA",
  inputAmountAtomic: "200",
  outputAmountAtomic: "490",
  providerId: "paper-verified",
  priceImpactBps: 10,
  observedAt: 3_100,
  expiresAt: 4_000,
};
const evidence = { ...evidencePayload, evidenceHash: hashPaperQuoteEvidence(evidencePayload) };
snapshot.paperFills = [{
  fillId: "human-fill",
  orderId: "human-order",
  quoteId: evidence.quoteId,
  participantType: "HUMAN",
  participantId: wallet,
  accountId: "human-account",
  inputAssetId: "USDG",
  outputAssetId: "NVDA",
  inputAmountAtomic: "200",
  outputAmountAtomic: "490",
  providerId: evidence.providerId,
  feeAmountAtomic: "0",
  gasCostAtomic: "0",
  filledAt: evidence.observedAt,
  evidenceHash: evidence.evidenceHash,
  quoteEvidence: evidence,
}];

const pool = new RecordingPool();
const store = new PostgresAgentStateStore(pool);
await store.commit({
  streamId,
  expectedRevision: 0,
  idempotencyKey: "human-projector-1",
  operation: "humanProjectorSmoke",
  requestHash: hashCanonicalPayload({ operation: "humanProjectorSmoke", payload: {} }),
  result: { ok: true },
  snapshot,
  createdAt: 5_000,
});

const orderInsert = pool.client.calls.find((call) => call.text.includes("INSERT INTO paper_orders"));
assert.ok(orderInsert?.values);
assert.equal(orderInsert.values?.[2], "HUMAN");
assert.equal(orderInsert.values?.[3], wallet);
assert.equal(orderInsert.values?.[4], null);
assert.equal(orderInsert.values?.[5], null);
assert.equal(orderInsert.values?.[6], "RMT_HUMAN_MANUAL_V1");

const fillInsert = pool.client.calls.find((call) => call.text.includes("INSERT INTO paper_fills"));
assert.ok(fillInsert?.values);
assert.equal(fillInsert.values?.[4], "HUMAN");
assert.equal(fillInsert.values?.[5], wallet);
assert.equal(fillInsert.values?.[6], null);

assert.match(agentEngineSchemaSql, /participant_type IN \('AGENT','HUMAN'\)/);
assert.match(agentEngineSchemaSql, /paper_orders_origin_check/);
assert.match(agentEngineSchemaSql, /paper_fills_origin_check/);
assert.match(agentEngineSchemaSql, /participant_type = 'HUMAN'.*agent_id IS NULL.*strategy_version IS NULL.*manual_policy_version IS NOT NULL/s);
assert.match(agentEngineSchemaSql, /participant_type = 'HUMAN'.*agent_id IS NULL/s);

console.log("human-paper-persistence smoke: ok");
