import {
  assertAtomicAmount,
  assertNonEmptyString,
  type PaperAccountRecord,
  type ParticipantType,
} from "./schema.ts";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CANONICAL_EVM_ADDRESS = /^0x[0-9a-f]{40}$/;

function fail(message: string): never {
  throw new Error(message);
}

export function normalizeHumanParticipantId(value: string): string {
  assertNonEmptyString(value, "human participantId");
  const normalized = value.trim();
  if (!EVM_ADDRESS.test(normalized)) fail("human participantId must be a 20-byte EVM wallet address");
  return normalized.toLowerCase();
}

export function normalizePaperParticipantId(participantType: ParticipantType, value: string): string {
  if (participantType === "HUMAN") return normalizeHumanParticipantId(value);
  if (participantType !== "AGENT") fail("unsupported paper participant type");
  assertNonEmptyString(value, "agent participantId");
  return value.trim();
}

export function paperParticipantKey(participantType: ParticipantType, participantId: string): string {
  return `${participantType}:${normalizePaperParticipantId(participantType, participantId)}`;
}

export function assertPaperAccountParticipantIdentity(account: PaperAccountRecord): void {
  assertNonEmptyString(account.accountId, "paper accountId");
  assertNonEmptyString(account.seasonId, "paper seasonId");
  const canonicalId = normalizePaperParticipantId(account.participantType, account.participantId);
  if (account.participantId !== canonicalId) fail("paper participantId is not canonical");
  if (account.participantType === "HUMAN" && !CANONICAL_EVM_ADDRESS.test(account.participantId)) {
    fail("human participantId must be a lowercase EVM wallet address");
  }
  if (!Number.isSafeInteger(account.openedAt) || account.openedAt < 0) fail("paper account openedAt must be a non-negative safe integer");
  if (Object.keys(account.balances).length === 0) fail("paper account requires at least one balance entry");
  for (const [assetId, amount] of Object.entries(account.balances)) {
    assertNonEmptyString(assetId, "paper balance assetId");
    assertAtomicAmount(amount, `paper balance ${assetId}`);
  }
}

export function assertUniquePaperParticipantAccounts(accounts: PaperAccountRecord[]): void {
  const seen = new Set<string>();
  for (const account of accounts) {
    assertPaperAccountParticipantIdentity(account);
    const key = `${account.seasonId}:${paperParticipantKey(account.participantType, account.participantId)}`;
    if (seen.has(key)) fail("paper participant already has an account for season");
    seen.add(key);
  }
}
