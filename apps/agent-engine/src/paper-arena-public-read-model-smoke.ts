import assert from "node:assert/strict";
import { hashCanonicalPayload, type ParticipantType } from "../../../packages/agent-core/src/index.ts";
import type { PaperArenaAuthoritativeMatchupRecord } from "./paper-arena-authoritative-matchup.ts";
import type { PaperArenaEntryRecord } from "./paper-arena-entry.ts";
import { buildPaperArenaMatchup } from "./paper-arena-matchup.ts";
import {
  PaperArenaPublicReadService,
  assertPaperArenaPublicReadModel,
  buildPaperArenaPublicReadModel,
  type PaperArenaAuthoritativeMatchupReader,
} from "./paper-arena-public-read-model.ts";
import type { PaperArenaRosterRecord } from "./paper-arena-roster.ts";
import { emptyAgentEngineSnapshot } from "./snapshot.ts";

const streamId = "public-arena";
const season = { seasonId: "season-public", name: "Public Arena", startsAt: 1_000, endsAt: 10_000, createdAt: 900 };
const quoteAssetId = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const startingNavQuoteAtomic = "1000000";

function makeEntry(input: {
  participantType: ParticipantType;
  participantId: string;
  accountId: string;
}): PaperArenaEntryRecord {
  const snapshot = emptyAgentEngineSnapshot();
  const account = {
    accountId: input.accountId,
    seasonId: season.seasonId,
    participantType: input.participantType,
    participantId: input.participantId,
    balances: { [quoteAssetId]: startingNavQuoteAtomic },
    openedAt: 1_100,
  } as const;
  snapshot.seasons = [season];
  snapshot.paperAccounts = [account];
  const payload: Omit<PaperArenaEntryRecord, "entryHash"> = {
    schemaVersion: 1,
    streamId,
    revision: 1,
    engineSnapshot: snapshot,
    engineStateHash: hashCanonicalPayload(snapshot),
    season,
    account,
    participantType: input.participantType,
    participantId: input.participantId,
    quoteAssetId,
    startingNavQuoteAtomic,
    enteredAt: 1_100,
  };
  return { ...payload, entryHash: hashCanonicalPayload(payload) };
}

const agentEntry = makeEntry({ participantType: "AGENT", participantId: "agent-public", accountId: "account-agent-public" });
const humanEntry = makeEntry({
  participantType: "HUMAN",
  participantId: "0x00000000000000000000000000000000000000aa",
  accountId: "account-human-public",
});
const rosterPayload: Omit<PaperArenaRosterRecord, "rosterHash"> = {
  schemaVersion: 1,
  streamId,
  seasonId: season.seasonId,
  quoteAssetId,
  startingNavQuoteAtomic,
  entries: [agentEntry, humanEntry],
  agentCount: 1,
  humanCount: 1,
};
const roster: PaperArenaRosterRecord = { ...rosterPayload, rosterHash: hashCanonicalPayload(rosterPayload) };
const matchup = buildPaperArenaMatchup({ roster, netPerformances: [] });
const authoritativePayload: Omit<PaperArenaAuthoritativeMatchupRecord, "snapshotHash"> = {
  schemaVersion: 1,
  streamId,
  seasonId: season.seasonId,
  roster,
  latestNetPerformances: [],
  latestPerformanceDigest: hashCanonicalPayload([]),
  matchup,
};
const authoritative: PaperArenaAuthoritativeMatchupRecord = {
  ...authoritativePayload,
  snapshotHash: hashCanonicalPayload(authoritativePayload),
};

const direct = buildPaperArenaPublicReadModel(authoritative);
assert.equal(direct.status, "PROVISIONAL");
assert.equal(direct.winner, null);
assert.equal(direct.roster.totalCount, 2);
assert.equal(direct.roster.agentCount, 1);
assert.equal(direct.roster.humanCount, 1);
assert.equal(direct.overall.ranked.length, 0);
assert.equal(direct.agents.ranked.length, 0);
assert.equal(direct.humans.ranked.length, 0);
assert.doesNotThrow(() => assertPaperArenaPublicReadModel(direct));

class Reader implements PaperArenaAuthoritativeMatchupReader {
  async snapshot(seasonId: string): Promise<PaperArenaAuthoritativeMatchupRecord> {
    assert.equal(seasonId, season.seasonId);
    return structuredClone(authoritative);
  }
}
const fromService = await new PaperArenaPublicReadService(new Reader()).read(season.seasonId);
assert.deepEqual(fromService, direct);

const serialized = JSON.stringify(fromService);
for (const forbidden of [
  "engineSnapshot",
  "engineStateHash",
  "accountSnapshot",
  "balances",
  "strategyHash",
  "StrategySpec",
  "modelIdentity",
  "reasoningSummary",
  "quoteEvidence",
  "ownerAddress",
  "thesis",
  "valuation",
  "netPerformances",
  "basePerformance",
]) {
  assert.equal(serialized.includes(forbidden), false, `public Arena payload leaked forbidden field ${forbidden}`);
}
assert.ok(serialized.includes("authoritativeSnapshotHash"));
assert.ok(serialized.includes("rosterHash"));
assert.ok(serialized.includes("latestPerformanceDigest"));

const tampered = structuredClone(fromService);
tampered.roster.totalCount = 99;
assert.throws(() => assertPaperArenaPublicReadModel(tampered), /read-model hash mismatch/);

console.log("paper-arena-public-read-model smoke: ok");
