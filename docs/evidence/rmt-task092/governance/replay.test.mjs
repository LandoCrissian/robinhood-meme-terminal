import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {verifyCaptureEvidence,verifyAuthorityEvidence} from "../../rmt-task091/governance/verify-evidence.mjs";
import {validateReviewPacket,DIGEST} from "../../rmt-task091/governance/review-packet.mjs";
const load=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const zipped=p=>JSON.parse(gunzipSync(readFileSync(new URL(p,import.meta.url))));
const capture=()=>zipped("current/capture.json.gz");
const inputs={protocol:load("../../mobile-signing/protocol-mainnet.json"),profile:load("../../fixed-supply-security/4663-profile.json"),scheduled:load("../../mobile-signing/factory-publication-scheduled.json")};
test("replay Task092 fresh206 exact public calls, canonical schedule and14runtime pins",()=>{
 const report=capture();assert.equal(verifyCaptureEvidence(report,inputs).status,"RAW_EVIDENCE_REPLAYED");
 assert.equal(report.anchor.number,"119385107");assert.equal(report.state.pending[0],DIGEST);
 assert.equal(report.state.nonce,"0");assert.equal(report.state.signerSetEpoch,"1");assert.equal(report.account.confirmedNonce,"494");assert.equal(report.account.pendingNonce,"494");
});
test("exact unsigned publication remains review only, expires at original real deadline",()=>{
 const report=capture(),packet=load("current/unsigned-execute-review.json");
 assert.equal(validateReviewPacket(packet,report,report.anchor.timestamp).signingAuthorized,false);
 assert.equal(packet.action.deadline,"1795722606");assert.equal(packet.valueWei,"0");
 const altered=structuredClone(packet);altered.accountNonce="495";assert.throws(()=>validateReviewPacket(altered,report,report.anchor.timestamp));
 assert.throws(()=>validateReviewPacket(packet,report,1795722607n));
});
test("replay current114 exact authority/Safe reads and unpublished migration template",()=>{
 const report=zipped("current/authority.json.gz");
 assert.equal(verifyAuthorityEvidence(report,{treasury:load("../../mobile-signing/treasuries-mainnet.json"),safeRegistry:load("../../rmt-task044/safe-infrastructure-4663.json").registry.contracts["1.4.1"]}).status,"RAW_AUTHORITY_EVIDENCE_REPLAYED");
 assert.equal(report.anchor.number,"119391740");assert.equal(report.directory.latestVersion,"0");
 assert.equal(report.directory.pending[0],DIGEST);
});
