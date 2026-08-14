import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperArenaNetLeaderboardRecord,
  buildPaperArenaNetLeaderboard,
  type PaperArenaNetLeaderboardRecord,
} from "./paper-arena-net-leaderboard.ts";
import {
  assertPaperArenaNetPerformanceRecord,
  type PaperArenaNetPerformanceRecord,
} from "./paper-arena-net-performance.ts";
import {
  assertPaperArenaRosterRecord,
  type PaperArenaRosterRecord,
} from "./paper-arena-roster.ts";

export type PaperArenaTeamType = "AGENT" | "HUMAN";
export type PaperArenaMatchupStatus = "PROVISIONAL" | "FINALIZABLE";
export type PaperArenaMatchupWinner = PaperArenaTeamType | "TIE" | null;

export interface PaperArenaTeamSummary {
  participantType: PaperArenaTeamType;
  registeredCount: number;
  performanceCount: number;
  eligibleCount: number;
  provisionalCount: number;
  missingParticipantIds: string[];
  sumNetReturnQuoteAtomic: string;
  meanNetReturnQuoteAtomic: string | null;
  topParticipantId: string | null;
}

export interface PaperArenaMatchupRecord {
  schemaVersion: 1;
  roster: PaperArenaRosterRecord;
  netPerformances: PaperArenaNetPerformanceRecord[];
  overallLeaderboard: PaperArenaNetLeaderboardRecord | null;
  agentLeaderboard: PaperArenaNetLeaderboardRecord | null;
  humanLeaderboard: PaperArenaNetLeaderboardRecord | null;
  agentTeam: PaperArenaTeamSummary;
  humanTeam: PaperArenaTeamSummary;
  status: PaperArenaMatchupStatus;
  winner: PaperArenaMatchupWinner;
  capturedAt: number;
  matchupHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function assertSignedAtomic(value: string, field: string): void {
  if (!/^-?(0|[1-9]\d*)$/.test(value) || value === "-0") fail(`${field} must be a canonical signed integer string`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function identity(type: PaperArenaTeamType, participantId: string): string {
  return `${type}:${participantId}`;
}

function performanceIdentity(performance: PaperArenaNetPerformanceRecord): string {
  const entry = performance.basePerformance.entry;
  return identity(entry.participantType, entry.participantId);
}

function visiblePerformances(performances: PaperArenaNetPerformanceRecord[], type: PaperArenaTeamType): PaperArenaNetPerformanceRecord[] {
  return performances.filter((performance) => performance.basePerformance.entry.participantType === type);
}

function maybeLeaderboard(
  performances: PaperArenaNetPerformanceRecord[],
  view: "OVERALL" | "AGENT" | "HUMAN",
): PaperArenaNetLeaderboardRecord | null {
  const visible = view === "OVERALL"
    ? performances
    : performances.filter((performance) => performance.basePerformance.entry.participantType === view);
  if (visible.length === 0) return null;
  return buildPaperArenaNetLeaderboard({ netPerformances: performances, view });
}

function teamSummary(input: {
  roster: PaperArenaRosterRecord;
  performances: PaperArenaNetPerformanceRecord[];
  type: PaperArenaTeamType;
}): PaperArenaTeamSummary {
  const rosterEntries = input.roster.entries.filter((entry) => entry.participantType === input.type);
  const performances = visiblePerformances(input.performances, input.type);
  const byIdentity = new Map(performances.map((performance) => [performanceIdentity(performance), performance]));
  const missingParticipantIds = rosterEntries
    .filter((entry) => !byIdentity.has(identity(input.type, entry.participantId)))
    .map((entry) => entry.participantId)
    .sort();
  const eligible = performances.filter((performance) => performance.eligibility === "ELIGIBLE");
  const provisional = performances.filter((performance) => performance.eligibility === "PROVISIONAL");
  const sum = eligible.reduce((total, performance) => total + BigInt(performance.metrics.netReturnQuoteAtomic), 0n);
  const ranked = eligible.slice().sort((left, right) => {
    const leftReturn = BigInt(left.metrics.netReturnQuoteAtomic);
    const rightReturn = BigInt(right.metrics.netReturnQuoteAtomic);
    if (leftReturn !== rightReturn) return leftReturn > rightReturn ? -1 : 1;
    if (left.metrics.netMaxDrawdownBps !== right.metrics.netMaxDrawdownBps) return left.metrics.netMaxDrawdownBps - right.metrics.netMaxDrawdownBps;
    return left.basePerformance.entry.participantId.localeCompare(right.basePerformance.entry.participantId);
  });
  return {
    participantType: input.type,
    registeredCount: rosterEntries.length,
    performanceCount: performances.length,
    eligibleCount: eligible.length,
    provisionalCount: provisional.length,
    missingParticipantIds,
    sumNetReturnQuoteAtomic: sum.toString(),
    meanNetReturnQuoteAtomic: eligible.length > 0 ? (sum / BigInt(eligible.length)).toString() : null,
    topParticipantId: ranked[0]?.basePerformance.entry.participantId ?? null,
  };
}

function compareCompleteTeams(agent: PaperArenaTeamSummary, human: PaperArenaTeamSummary): PaperArenaMatchupWinner {
  if (agent.registeredCount === 0 || human.registeredCount === 0) return null;
  const agentComplete = agent.missingParticipantIds.length === 0 && agent.provisionalCount === 0 && agent.eligibleCount === agent.registeredCount;
  const humanComplete = human.missingParticipantIds.length === 0 && human.provisionalCount === 0 && human.eligibleCount === human.registeredCount;
  if (!agentComplete || !humanComplete) return null;
  const agentNumerator = BigInt(agent.sumNetReturnQuoteAtomic) * BigInt(human.eligibleCount);
  const humanNumerator = BigInt(human.sumNetReturnQuoteAtomic) * BigInt(agent.eligibleCount);
  if (agentNumerator === humanNumerator) return "TIE";
  return agentNumerator > humanNumerator ? "AGENT" : "HUMAN";
}

function derive(input: {
  roster: PaperArenaRosterRecord;
  netPerformances: PaperArenaNetPerformanceRecord[];
}): Omit<PaperArenaMatchupRecord, "matchupHash"> {
  assertPaperArenaRosterRecord(input.roster);
  const performances = input.netPerformances.map((performance) => structuredClone(performance));
  performances.forEach(assertPaperArenaNetPerformanceRecord);
  const rosterIdentities = new Set(input.roster.entries.map((entry) => identity(entry.participantType, entry.participantId)));
  const seen = new Set<string>();
  for (const performance of performances) {
    const entry = performance.basePerformance.entry;
    const key = performanceIdentity(performance);
    if (!rosterIdentities.has(key)) fail("Arena matchup performance belongs to an unregistered participant");
    if (seen.has(key)) fail("Arena matchup contains duplicate participant performance");
    seen.add(key);
    if (entry.streamId !== input.roster.streamId || entry.season.seasonId !== input.roster.seasonId) fail("Arena matchup performance belongs to a different competition");
    if (entry.quoteAssetId !== input.roster.quoteAssetId || entry.startingNavQuoteAtomic !== input.roster.startingNavQuoteAtomic) fail("Arena matchup performance economics differ from roster");
  }
  performances.sort((left, right) => performanceIdentity(left).localeCompare(performanceIdentity(right)));
  const agentTeam = teamSummary({ roster: input.roster, performances, type: "AGENT" });
  const humanTeam = teamSummary({ roster: input.roster, performances, type: "HUMAN" });
  const winner = compareCompleteTeams(agentTeam, humanTeam);
  const capturedAt = performances.length > 0
    ? Math.max(...performances.map((performance) => performance.capturedAt))
    : Math.max(...input.roster.entries.map((entry) => entry.enteredAt));
  return {
    schemaVersion: 1,
    roster: structuredClone(input.roster),
    netPerformances: performances,
    overallLeaderboard: maybeLeaderboard(performances, "OVERALL"),
    agentLeaderboard: maybeLeaderboard(performances, "AGENT"),
    humanLeaderboard: maybeLeaderboard(performances, "HUMAN"),
    agentTeam,
    humanTeam,
    status: winner === null ? "PROVISIONAL" : "FINALIZABLE",
    winner,
    capturedAt,
  };
}

function assertTeamSummary(summary: PaperArenaTeamSummary): void {
  if (summary.participantType !== "AGENT" && summary.participantType !== "HUMAN") fail("Arena team participantType is invalid");
  assertNonNegativeSafeInteger(summary.registeredCount, "Arena team registeredCount");
  assertNonNegativeSafeInteger(summary.performanceCount, "Arena team performanceCount");
  assertNonNegativeSafeInteger(summary.eligibleCount, "Arena team eligibleCount");
  assertNonNegativeSafeInteger(summary.provisionalCount, "Arena team provisionalCount");
  assertSignedAtomic(summary.sumNetReturnQuoteAtomic, "Arena team sum net return");
  if (summary.meanNetReturnQuoteAtomic !== null) assertSignedAtomic(summary.meanNetReturnQuoteAtomic, "Arena team mean net return");
}

export function assertPaperArenaMatchupRecord(record: PaperArenaMatchupRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported Arena matchup schema version");
  assertPaperArenaRosterRecord(record.roster);
  record.netPerformances.forEach(assertPaperArenaNetPerformanceRecord);
  if (record.overallLeaderboard) assertPaperArenaNetLeaderboardRecord(record.overallLeaderboard);
  if (record.agentLeaderboard) assertPaperArenaNetLeaderboardRecord(record.agentLeaderboard);
  if (record.humanLeaderboard) assertPaperArenaNetLeaderboardRecord(record.humanLeaderboard);
  assertTeamSummary(record.agentTeam);
  assertTeamSummary(record.humanTeam);
  assertTimestamp(record.capturedAt, "Arena matchup capturedAt");
  const rebuilt = derive({ roster: record.roster, netPerformances: record.netPerformances });
  const { matchupHash, ...payload } = record;
  if (hashCanonicalPayload(rebuilt) !== hashCanonicalPayload(payload)) fail("Arena matchup payload is not correctly derived from roster/performance evidence");
  assertHash(matchupHash, "Arena matchupHash");
  if (matchupHash !== hashCanonicalPayload(payload)) fail("Arena matchup hash mismatch");
}

export function buildPaperArenaMatchup(input: {
  roster: PaperArenaRosterRecord;
  netPerformances: PaperArenaNetPerformanceRecord[];
}): PaperArenaMatchupRecord {
  const payload = derive(input);
  const record: PaperArenaMatchupRecord = { ...payload, matchupHash: hashCanonicalPayload(payload) };
  assertPaperArenaMatchupRecord(record);
  return record;
}
