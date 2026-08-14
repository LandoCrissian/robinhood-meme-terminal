import assert from "node:assert/strict";
import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import type { PaperArenaAuthoritativeMatchupRecord } from "./paper-arena-authoritative-matchup.ts";
import type { PaperArenaEntryRecord } from "./paper-arena-entry.ts";
import { buildPaperArenaMatchup } from "./paper-arena-matchup.ts";
import { buildPaperArenaNetPerformance } from "./paper-arena-net-performance.ts";
import { buildPaperArenaPerformance, type PaperArenaPerformancePolicy } from "./paper-arena-performance.ts";
import {
  PaperArenaPublicParticipantProfileService,
  assertPaperArenaPublicParticipantProfile,
} from "./paper-arena-public-participant-profile.ts";
import type { PaperArenaAuthoritativeMatchupReader } from "./paper-arena-public-read-model.ts";
import type { PaperArenaRosterRecord } from "./paper-arena-roster.ts";
import { PaperCanonicalValuationService } from "./paper-canonical-valuation.ts";
import { emptyAgentEngineSnapshot } from "./snapshot.ts";
import { InMemoryAgentStateStore } from "./persistence/store.ts";

const streamId = "public-participant-profile";
const season = { seasonId: "season-profile", name: "Profile Season", startsAt: 0, endsAt: 10_000, createdAt: 0 };
const quoteAssetId = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const startingNav = "1000000";
const agentId = "agent-profile";
const humanWallet = "0x00000000000000000000000000000000000000aa";
const ownerAddress = "0x00000000000000000000000000000000000000ff";
const privateThesis = "This internal thesis must never appear in the public participant profile.";
const performancePolicy: PaperArenaPerformancePolicy = {
  policyVersion: "RMT_ARENA_PERFORMANCE_V1",
  minimumValuations: 3,
  minimumElapsedMs: 200,
};

function entryFor(input: { participantType: "AGENT" | "HUMAN"; participantId: string; accountId: string }): PaperArenaEntryRecord {
  const snapshot = emptyAgentEngineSnapshot();
  const account = {
    accountId: input.accountId,
    seasonId: season.seasonId,
    participantType: input.participantType,
    participantId: input.participantId,
    balances: { [quoteAssetId]: startingNav },
    openedAt: 10,
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
    startingNavQuoteAtomic: startingNav,
    enteredAt: 10,
  };
  return { ...payload, entryHash: hashCanonicalPayload(payload) };
}

const agentEntry = entryFor({ participantType: "AGENT", participantId: agentId, accountId: "account-agent-profile" });
const humanEntry = entryFor({ participantType: "HUMAN", participantId: humanWallet, accountId: "account-human-profile" });

async function agentNetPerformance() {
  const snapshot = emptyAgentEngineSnapshot();
  snapshot.seasons = [season];
  snapshot.paperAccounts = [structuredClone(agentEntry.account)];
  const store = new InMemoryAgentStateStore();
  await store.commit({
    streamId,
    expectedRevision: 0,
    idempotencyKey: "agent-profile-entry",
    operation: "agentProfileEntry",
    requestHash: hashCanonicalPayload({ step: "entry" }),
    result: { ok: true },
    snapshot,
    createdAt: 20,
  });
  const valuationService = new PaperCanonicalValuationService({ store, streamId });
  const valuations = [];
  let revision = 1;
  for (const [index, point] of [{ at: 100, nav: startingNav }, { at: 200, nav: "1000040" }, { at: 300, nav: "1000050" }].entries()) {
    const next = structuredClone(snapshot);
    next.paperAccounts[0]!.balances[quoteAssetId] = point.nav;
    await store.commit({
      streamId,
      expectedRevision: revision,
      idempotencyKey: `agent-profile-valuation-${index}`,
      operation: "agentProfileValuation",
      requestHash: hashCanonicalPayload({ index, point }),
      result: point,
      snapshot: next,
      createdAt: point.at,
    });
    revision += 1;
    valuations.push(await valuationService.value({
      accountId: agentEntry.account.accountId,
      quoteAssetId,
      quoteResults: [],
      valuedAt: point.at,
      maximumQuoteAgeMs: 100,
    }));
  }
  return buildPaperArenaNetPerformance({
    basePerformance: buildPaperArenaPerformance({ entry: agentEntry, valuations, policy: performancePolicy }),
  });
}

const agentPerformance = await agentNetPerformance();
const rosterPayload: Omit<PaperArenaRosterRecord, "rosterHash"> = {
  schemaVersion: 1,
  streamId,
  seasonId: season.seasonId,
  quoteAssetId,
  startingNavQuoteAtomic: startingNav,
  entries: [agentEntry, humanEntry],
  agentCount: 1,
  humanCount: 1,
};
const roster: PaperArenaRosterRecord = { ...rosterPayload, rosterHash: hashCanonicalPayload(rosterPayload) };
const matchup = buildPaperArenaMatchup({ roster, netPerformances: [agentPerformance] });
const authoritativePayload: Omit<PaperArenaAuthoritativeMatchupRecord, "snapshotHash"> = {
  schemaVersion: 1,
  streamId,
  seasonId: season.seasonId,
  roster,
  latestNetPerformances: [agentPerformance],
  latestPerformanceDigest: hashCanonicalPayload([{
    participant: `AGENT:${agentId}`,
    capturedAt: agentPerformance.capturedAt,
    netPerformanceHash: agentPerformance.netPerformanceHash,
    fullRecordHash: hashCanonicalPayload(agentPerformance),
  }]),
  matchup,
};
const authoritative: PaperArenaAuthoritativeMatchupRecord = {
  ...authoritativePayload,
  snapshotHash: hashCanonicalPayload(authoritativePayload),
};

class MatchupReader implements PaperArenaAuthoritativeMatchupReader {
  async snapshot(seasonId: string): Promise<PaperArenaAuthoritativeMatchupRecord> {
    assert.equal(seasonId, season.seasonId);
    return structuredClone(authoritative);
  }
}

const canonicalState = emptyAgentEngineSnapshot();
canonicalState.seasons = [season];
canonicalState.paperAccounts = [structuredClone(agentEntry.account), structuredClone(humanEntry.account)];
canonicalState.agents = [{
  id: agentId,
  ownerAddress,
  name: "HoodHound",
  thesis: privateThesis,
  performanceState: "PAPER_ACTIVE",
  executionMode: "PAPER_ONLY",
  createdAt: 5,
}];
const stateStore = new InMemoryAgentStateStore();
await stateStore.commit({
  streamId,
  expectedRevision: 0,
  idempotencyKey: "profile-current-state",
  operation: "profileCurrentState",
  requestHash: hashCanonicalPayload({ step: "current" }),
  result: { ok: true },
  snapshot: canonicalState,
  createdAt: 400,
});

const service = new PaperArenaPublicParticipantProfileService({
  reader: new MatchupReader(),
  stateStore,
  streamId,
});
const agentProfile = await service.read({ seasonId: season.seasonId, participantType: "AGENT", participantId: agentId });
assert.equal(agentProfile.identity.displayName, "HoodHound");
assert.equal(agentProfile.identity.agentLifecycleState, "PAPER_ACTIVE");
assert.equal(agentProfile.identity.createdAt, 5);
assert.equal(agentProfile.competition.status, "RANKED");
assert.equal(agentProfile.competition.rank, 1);
assert.equal(agentProfile.competition.netReturnQuoteAtomic, "50");
assert.equal(agentProfile.competition.matchupStatus, "PROVISIONAL");
assert.equal(agentProfile.competition.matchupWinner, null);
assert.doesNotThrow(() => assertPaperArenaPublicParticipantProfile(agentProfile));

const humanProfile = await service.read({
  seasonId: season.seasonId,
  participantType: "HUMAN",
  participantId: humanWallet.toUpperCase().replace("0X", "0x"),
});
assert.equal(humanProfile.participantId, humanWallet);
assert.equal(humanProfile.identity.displayName, null);
assert.equal(humanProfile.identity.agentLifecycleState, null);
assert.equal(humanProfile.identity.createdAt, null);
assert.equal(humanProfile.competition.status, "AWAITING_PERFORMANCE");
assert.equal(humanProfile.competition.rank, null);
assert.equal(humanProfile.source.performanceHash, null);
assert.doesNotThrow(() => assertPaperArenaPublicParticipantProfile(humanProfile));

for (const profile of [agentProfile, humanProfile]) {
  const serialized = JSON.stringify(profile);
  for (const forbidden of [
    ownerAddress,
    privateThesis,
    "ownerAddress",
    "thesis",
    "engineSnapshot",
    "accountSnapshot",
    "balances",
    "strategyHash",
    "modelIdentity",
    "reasoningSummary",
    "quoteEvidence",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `public participant profile leaked forbidden value/field ${forbidden}`);
  }
}

await assert.rejects(
  () => service.read({ seasonId: season.seasonId, participantType: "AGENT", participantId: "not-registered" }),
  /not registered/,
);

const tampered = structuredClone(agentProfile);
tampered.competition.rank = 99;
assert.throws(() => assertPaperArenaPublicParticipantProfile(tampered), /profile hash mismatch/);

console.log("paper-arena-public-participant-profile smoke: ok");
