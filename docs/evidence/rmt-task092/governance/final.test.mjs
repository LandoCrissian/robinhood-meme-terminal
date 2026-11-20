import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {verifyCaptureEvidence, verifyAuthorityEvidence} from "../../rmt-task091/governance/verify-evidence.mjs";
import {validateReviewPacket, DIGEST} from "../../rmt-task091/governance/review-packet.mjs";

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const zipped = p => JSON.parse(gunzipSync(readFileSync(new URL(p, import.meta.url))));

test("final Task092 dual-provider capture binds fourteen runtimes and the still-pending original action", () => {
  const report = zipped("final/capture.json.gz");
  assert.equal(verifyCaptureEvidence(report, {protocol: load("../../mobile-signing/protocol-mainnet.json"),
    profile: load("../../fixed-supply-security/4663-profile.json"),
    scheduled: load("../../mobile-signing/factory-publication-scheduled.json")}).status, "RAW_EVIDENCE_REPLAYED");
  assert.equal(report.anchor.number, "119431087");
  assert.equal(report.state.pending[0], DIGEST);
  assert.equal(report.state.nonce, "0");
  assert.equal(report.state.signerSetEpoch, "1");
  assert.equal(report.account.confirmedNonce, "494");
  assert.equal(report.account.pendingNonce, "494");
  const packet = load("final/unsigned-execute-review.json");
  assert.equal(validateReviewPacket(packet, report, report.anchor.timestamp).signingAuthorized, false);
  assert.throws(() => validateReviewPacket(packet, report, BigInt(report.anchor.timestamp) + 181n), /STALE_REVIEW/);
});

test("final independent authority reads retain the unpublished template and original pending action", () => {
  const report = zipped("final/authority.json.gz");
  assert.equal(verifyAuthorityEvidence(report, {treasury: load("../../mobile-signing/treasuries-mainnet.json"),
    safeRegistry: load("../../rmt-task044/safe-infrastructure-4663.json").registry.contracts["1.4.1"]}).status, "RAW_AUTHORITY_EVIDENCE_REPLAYED");
  assert.equal(report.directory.latestVersion, "0");
  assert.equal(report.directory.pending[0], DIGEST);
});
