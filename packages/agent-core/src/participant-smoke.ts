import assert from "node:assert/strict";
import {
  assertPaperAccountParticipantIdentity,
  assertUniquePaperParticipantAccounts,
  normalizeHumanParticipantId,
  normalizePaperParticipantId,
  paperParticipantKey,
  type PaperAccountRecord,
} from "./index.ts";

const humanWallet = "0xAbCdEf0000000000000000000000000000001234";
const canonicalHuman = "0xabcdef0000000000000000000000000000001234";

assert.equal(normalizeHumanParticipantId(`  ${humanWallet}  `), canonicalHuman);
assert.equal(normalizePaperParticipantId("HUMAN", humanWallet), canonicalHuman);
assert.equal(normalizePaperParticipantId("AGENT", "  agent-1  "), "agent-1");
assert.equal(paperParticipantKey("HUMAN", humanWallet), `HUMAN:${canonicalHuman}`);
assert.equal(paperParticipantKey("AGENT", "agent-1"), "AGENT:agent-1");
assert.throws(() => normalizeHumanParticipantId("not-a-wallet"), /20-byte EVM wallet address/);

const humanAccount: PaperAccountRecord = {
  accountId: "human-account-1",
  seasonId: "season-1",
  participantType: "HUMAN",
  participantId: canonicalHuman,
  balances: { USDG: "1000000000" },
  openedAt: 1_000,
};
const agentAccount: PaperAccountRecord = {
  accountId: "agent-account-1",
  seasonId: "season-1",
  participantType: "AGENT",
  participantId: "agent-1",
  balances: { USDG: "1000000000" },
  openedAt: 1_000,
};

assert.doesNotThrow(() => assertPaperAccountParticipantIdentity(humanAccount));
assert.doesNotThrow(() => assertPaperAccountParticipantIdentity(agentAccount));
assert.doesNotThrow(() => assertUniquePaperParticipantAccounts([humanAccount, agentAccount]));

assert.throws(
  () => assertPaperAccountParticipantIdentity({ ...humanAccount, participantId: humanWallet }),
  /not canonical/,
);
assert.throws(
  () => assertUniquePaperParticipantAccounts([humanAccount, { ...humanAccount, accountId: "human-account-2" }]),
  /already has an account for season/,
);
assert.throws(
  () => assertPaperAccountParticipantIdentity({ ...humanAccount, balances: {} }),
  /requires at least one balance entry/,
);

console.log("participant smoke: ok");
