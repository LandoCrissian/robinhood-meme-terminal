import assert from "node:assert/strict";
import test from "node:test";
import { emptyProjectTreasuryDraft, newProjectTreasuryIntent, projectTreasuryCreatorMatches, readProjectTreasuryDraft, readTreasuryLookupAddress, validateProjectTreasuryDraft } from "../project-treasury-draft";

const controller = "0x1234567890123456789012345678901234567890";
const intentId = "0x" + "12".repeat(32);
test("per-project draft storage restores only known versioned bounded fields", () => {
  assert.deepEqual(readProjectTreasuryDraft(emptyProjectTreasuryDraft), emptyProjectTreasuryDraft);
  for (const value of [{ ...emptyProjectTreasuryDraft, schemaVersion: 2 }, { ...emptyProjectTreasuryDraft, secret: "not accepted" },
    { ...emptyProjectTreasuryDraft, controller: "x".repeat(43) }, { ...emptyProjectTreasuryDraft, mode: "auto-buy" }, { ...emptyProjectTreasuryDraft, intentId: null }]) assert.equal(readProjectTreasuryDraft(value), undefined);
});
test("no opt-in requires neither deployment nor a treasury fee beneficiary", () => {
  const r = validateProjectTreasuryDraft(emptyProjectTreasuryDraft); assert.ok(r.ok);
  assert.equal(r.draft.controller, null); assert.equal(r.draft.intentId, null); assert.equal(r.draft.treasuryShareBps, 0); assert.equal(r.draft.purchasesEnabled, false);
});
test("0–100 percent is exclusively the project's unchanged 9000 basis-point share", () => {
  for (const [sharePercent, treasuryShareBps] of [["0", 0], ["25", 2250], ["50", 4500], ["100", 9000], ["33.33", 2999], ["0.02", 1]] as const) {
    const r = validateProjectTreasuryDraft({ ...emptyProjectTreasuryDraft, mode: "contract", controller, intentId, sharePercent }); assert.ok(r.ok);
    assert.equal(r.draft.treasuryShareBps, treasuryShareBps); assert.equal(r.draft.purchasesEnabled, false);
  }
  for (const sharePercent of ["100.01", "-1", "1e2", "0.01", "1.234", "Infinity", ""]) {
    const r = validateProjectTreasuryDraft({ ...emptyProjectTreasuryDraft, mode: "contract", controller, intentId, sharePercent }); assert.equal(r.ok, false, sharePercent);
  }
});
test("controller, creation intent and optional collection are explicit validated public identities", () => {
  const r = validateProjectTreasuryDraft({ ...emptyProjectTreasuryDraft, mode: "contract", controller, controllerKind: "safe-1.4.1", intentId,
    projectKind: "nft-community", nftCollection: controller, sharePercent: "100" }); assert.ok(r.ok);
  assert.equal(r.draft.controllerKind, "safe-1.4.1"); assert.equal(r.draft.nftCollection, controller);
  for (const patch of [{ controller: "0x" + "0".repeat(40) }, { intentId: "0x" + "0".repeat(64) }, { nftCollection: "not-an-address", projectKind: "nft-community" as const }]) {
    assert.equal(validateProjectTreasuryDraft({ ...emptyProjectTreasuryDraft, mode: "contract", controller, intentId, ...patch }).ok, false);
  }
});
test("project intent uses secure random bytes and rejects an all-zero source", () => {
  const source = (byte: number): Pick<Crypto, "getRandomValues"> => ({ getRandomValues: <T extends ArrayBufferView | null>(value: T) => {
    assert.ok(value instanceof Uint8Array); value.fill(byte); return value;
  } });
  assert.equal(newProjectTreasuryIntent(source(18)), intentId);
  assert.throws(() => newProjectTreasuryIntent(source(0)));
});
test("zero project-fee allocation never erases the verified two-step creator identity", () => {
  const terms = validateProjectTreasuryDraft({ ...emptyProjectTreasuryDraft, mode: "contract", controller, intentId, sharePercent: "0" }); assert.ok(terms.ok);
  assert.equal(terms.draft.treasuryShareBps, 0);
  const normalizedCoreFields = { treasury: "", treasuryShareBps: 0 };
  assert.equal(normalizedCoreFields.treasury, "", "The core factory receives zero address at0%, not an invented fee beneficiary");
  assert.equal(projectTreasuryCreatorMatches(controller.toLowerCase(), intentId, controller), true);
  assert.equal(projectTreasuryCreatorMatches("0x2234567890123456789012345678901234567890", intentId, controller), false, "Switching wallets cannot reuse another creator's optional treasury proof");
  assert.equal(projectTreasuryCreatorMatches(controller, intentId), false, "An intent alone is insufficient even when core fee fields are empty");
  assert.equal(projectTreasuryCreatorMatches(controller, undefined, controller), false);
  assert.equal(projectTreasuryCreatorMatches(controller), true, "Ordinary opted-out creation needs no optional treasury identity");
});
test("treasury lookup binds the submitted form value rather than a stale controlled-input event", () => {
  const data = new FormData(); data.set("treasuryAddress", " " + controller + " ");
  assert.equal(readTreasuryLookupAddress(data), controller);
  data.append("treasuryAddress", "0x2234567890123456789012345678901234567890");
  assert.equal(readTreasuryLookupAddress(data), null, "Duplicated submitted identities are ambiguous");
  data.delete("treasuryAddress"); assert.equal(readTreasuryLookupAddress(data), null);
  data.set("treasuryAddress", "invalid"); assert.equal(readTreasuryLookupAddress(data), null);
  data.set("treasuryAddress", "0x" + "0".repeat(40)); assert.equal(readTreasuryLookupAddress(data), null);
});
