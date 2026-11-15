import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { webTools } from "../rmt-task043/compile-rotation-profile.mjs";
import { validateInputs } from "../rmt-task043/deploy-rotation.mjs";

const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const blank = json(new URL("./owner-inputs.json", import.meta.url));
const frozen = json(new URL("../rmt-task043/4663-rotation-profile.json", import.meta.url));
const { approved, ...terms } = frozen.provisionalTerms;
assert.equal(approved, false);
assert.deepEqual(blank.economics.proposed, terms, "Owner sheet draft terms do not match the compiler profile");

function exactKeys(value, exemplar) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Expected owner sheet object");
  assert.deepEqual(Object.keys(value).sort(), Object.keys(exemplar).sort(), "Unexpected owner sheet fields");
}

export function normalizeOwnerSheet(sheet, getAddress) {
  exactKeys(sheet, blank);
  exactKeys(sheet.economics, blank.economics);
  exactKeys(sheet.responsibilities, blank.responsibilities);
  assert.deepEqual(sheet.economics.proposed, terms, "Different terms require an explicitly reviewed profile");
  const { approvalReference } = sheet.economics;
  const { signerKeyContinuity, incidentLead } = sheet.responsibilities;
  assert.ok(Array.isArray(signerKeyContinuity) && signerKeyContinuity.length === 3,
    "Assign key continuity for each of the three signer slots");
  const input = {
    profile: frozen.profile,
    chainId: frozen.chainId,
    broadcastAuthorized: false,
    operatingTreasury: sheet.operatingTreasury,
    futureReserve: sheet.futureReserve,
    deployer: sheet.deployer,
    confirmedDeployerNonce: null,
    governanceSigners: sheet.governanceSigners,
    governanceQuorum: frozen.governance.quorum,
    economics: terms,
    ownerApprovalReference: approvalReference,
  };
  const missingOwnerInputs = validateInputs(input, getAddress).filter((field) => field !== "confirmedDeployerNonce");
  if (approvalReference === null) missingOwnerInputs.push("economics.approvalReference");
  for (const [field, value] of [
    ...signerKeyContinuity.map((owner, i) => ["responsibilities.signerKeyContinuity[" + i + "]", owner]),
    ["responsibilities.incidentLead", incidentLead],
  ]) {
    if (value === null) missingOwnerInputs.push(field);
    else assert.ok(typeof value === "string" && value === value.trim() && value.length > 0 && value.length <= 160
      && !/[\p{C}\p{Zl}\p{Zp}]/u.test(value), "Expected a short public role reference for " + field);
  }
  return { missingOwnerInputs, deploymentInput: missingOwnerInputs.length ? null : input };
}

function main() {
  const { values } = parseArgs({ options: {
    sheet: { type: "string" }, checkout: { type: "string" }, output: { type: "string" },
  } });
  const viem = values.checkout && webTools(values.checkout);
  const { missingOwnerInputs, deploymentInput } = normalizeOwnerSheet(values.sheet ? json(values.sheet) : blank, viem?.getAddress);
  if (values.output) {
    assert.ok(values.sheet && values.checkout && deploymentInput, "Complete the owner sheet before preparing machine inputs");
    writeFileSync(resolve(values.output), JSON.stringify(deploymentInput, null, 2) + "\n", { flag: "wx" });
  }
  console.log(JSON.stringify({
    state: "BLOCKED_NO_BROADCAST", broadcastAuthorized: false,
    missingOwnerInputs, nonce: "REQUIRES_DIRECT_4663_PREFLIGHT",
    ownerApprovalReferenceVerified: false, machineInputWritten: Boolean(values.output),
  }, null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
