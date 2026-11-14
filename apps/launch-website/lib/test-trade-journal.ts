import { isTransactionHash } from "./test-creation";
import { isTestLifecycleRequest, type TestLifecycleRequest } from "./test-lifecycle";

export type TestTradeJournalEntry = { request: TestLifecycleRequest; transactionHash?: `0x${string}` };
export type TestTradeJournal = { pending?: TestTradeJournalEntry; history: TestTradeJournalEntry[] };

const maxHistory = 12;

// One pending request for all token pages on this fixture. Retain original envelopes for reorg checks.
export function testTradeJournalKey(deploymentHash: string) {
  return `rmt:test-trades:31337:v1:${deploymentHash.toLowerCase()}`;
}

function isEntry(value: unknown): value is TestTradeJournalEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<TestTradeJournalEntry>;
  return isTestLifecycleRequest(entry.request) &&
    (entry.transactionHash === undefined || isTransactionHash(entry.transactionHash));
}

export function readTestTradeJournal(key: string) {
  const raw = localStorage.getItem(key);
  if (!raw) return { history: [] } as TestTradeJournal;
  if (raw.length > 20_000) throw new Error("Test journal exceeds its storage bound");
  const data = JSON.parse(raw) as Partial<TestTradeJournal>;
  if (!data || !Array.isArray(data.history) || data.history.length > maxHistory ||
      !data.history.every((entry) => isEntry(entry) && isTransactionHash(entry.transactionHash)) ||
      (data.pending !== undefined && !isEntry(data.pending))) throw new Error("Test journal data is invalid");
  return { pending: data.pending, history: data.history };
}

export function writeTestTradeJournal(key: string, journal: TestTradeJournal) {
  localStorage.setItem(key, JSON.stringify(journal));
}

export function archiveTestTrade(journal: TestTradeJournal, entry: TestTradeJournalEntry) {
  return { history: [entry, ...journal.history].slice(0, maxHistory) };
}
