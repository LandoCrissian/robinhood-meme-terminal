import assert from "node:assert/strict";
import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import { InMemoryPaperArenaEntryStore } from "./paper-arena-entry-store.ts";
import {
  PaperArenaPublicSeasonCatalogService,
  assertPaperArenaPublicSeasonCatalog,
} from "./paper-arena-public-season-catalog.ts";
import type {
  PaperArenaSeasonFinalizationRecord,
  PaperArenaSeasonFinalizationStore,
} from "./paper-arena-season-finalization.ts";
import { emptyAgentEngineSnapshot } from "./snapshot.ts";
import { InMemoryAgentStateStore } from "./persistence/store.ts";

const streamId = "season-catalog";
const stateStore = new InMemoryAgentStateStore();
const snapshot = emptyAgentEngineSnapshot();
snapshot.seasons = [
  { seasonId: "ended", name: "Ended", startsAt: 1_000, endsAt: 2_000, createdAt: 900 },
  { seasonId: "active", name: "Active", startsAt: 4_000, endsAt: 7_000, createdAt: 3_900 },
  { seasonId: "upcoming", name: "Upcoming", startsAt: 6_000, endsAt: 9_000, createdAt: 5_900 },
];
await stateStore.commit({
  streamId,
  expectedRevision: 0,
  idempotencyKey: "catalog-state",
  operation: "catalogState",
  requestHash: hashCanonicalPayload({ seasons: snapshot.seasons }),
  result: { ok: true },
  snapshot,
  createdAt: 4_500,
});

class EmptyFinalizationStore implements PaperArenaSeasonFinalizationStore {
  async get(): Promise<PaperArenaSeasonFinalizationRecord | null> { return null; }
  async put(): Promise<PaperArenaSeasonFinalizationRecord> { throw new Error("not used"); }
}

const service = new PaperArenaPublicSeasonCatalogService({
  stateStore,
  entryStore: new InMemoryPaperArenaEntryStore(),
  finalizationStore: new EmptyFinalizationStore(),
  streamId,
});
const catalog = await service.read(5_000);
assert.deepEqual(catalog.seasons.map((season) => season.seasonId), ["upcoming", "active", "ended"]);
assert.equal(catalog.seasons.find((season) => season.seasonId === "upcoming")?.status, "UPCOMING");
assert.equal(catalog.seasons.find((season) => season.seasonId === "active")?.status, "ACTIVE");
assert.equal(catalog.seasons.find((season) => season.seasonId === "ended")?.status, "ENDED_UNFINALIZED");
assert.ok(catalog.seasons.every((season) => season.participants.totalCount === 0));
assert.ok(catalog.seasons.every((season) => season.finalResult === null));
assert.doesNotThrow(() => assertPaperArenaPublicSeasonCatalog(catalog));

const atEnd = await service.read(7_000);
assert.equal(atEnd.seasons.find((season) => season.seasonId === "active")?.status, "ACTIVE");
const afterEnd = await service.read(7_001);
assert.equal(afterEnd.seasons.find((season) => season.seasonId === "active")?.status, "ENDED_UNFINALIZED");

const tampered = structuredClone(catalog);
tampered.seasons[0]!.participants.totalCount = 5;
assert.throws(() => assertPaperArenaPublicSeasonCatalog(tampered), /counts do not add up|catalog hash mismatch/);

const serialized = JSON.stringify(catalog);
for (const forbidden of ["engineSnapshot", "balances", "ownerAddress", "thesis", "strategyHash", "modelIdentity", "quoteEvidence"]) {
  assert.equal(serialized.includes(forbidden), false, `public season catalog leaked forbidden field ${forbidden}`);
}

console.log("paper-arena-public-season-catalog smoke: ok");
