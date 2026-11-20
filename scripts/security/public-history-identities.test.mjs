import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {test} from "node:test";
import {verifyHistoryPublicIdentities} from "./public-history-identities.mjs";
const repository=fileURLToPath(new URL("../../",import.meta.url));
const findings=JSON.parse(gunzipSync(readFileSync(new URL("../../docs/evidence/rmt-task082/history/ci-history-68-raw-redacted.json.gz",import.meta.url))));
const git=(commit,path)=>execFileSync("git",["show",`${commit}:${path}`],{cwd:repository,windowsHide:true});
test("exact immutable public conduit, two synthetic addresses and two source-response hashes preserve raw failure",()=>{
  const result=verifyHistoryPublicIdentities(findings);assert.equal(result.status,"PASSED_EXACT_PUBLIC_DATA_ONLY");assert.equal(result.rawFindingCount,5);assert.equal(result.classified.length,5);assert.equal(result.rawScanPassed,false);assert.equal(result.financialSecurityClearance,false);assert.equal(result.productionAuthorization,false);assert.equal(result.detectorsChanged,false);
});
test("every new finding, duplicate or missing raw match blocks",()=>{
  assert.equal(verifyHistoryPublicIdentities([...findings,{...findings[0],Fingerprint:"new unrelated finding"}]).status,"BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING");
  assert.equal(verifyHistoryPublicIdentities([...findings,findings[0]]).status,"BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING");
  assert.equal(verifyHistoryPublicIdentities(findings.slice(1)).status,"BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING");
  assert.equal(verifyHistoryPublicIdentities([]).status,"BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING");
});
test("same-looking future values, paths, rules and source lines are never exempt",()=>{
  for(const change of[{Commit:"f".repeat(40)},{File:findings[0].File+".bak"},{StartLine:11},{EndLine:11},{RuleID:"another-detector"},{Match:'otherField: "REDACTED"'},{Secret:"not-redacted"}]){
    const rows=structuredClone(findings);Object.assign(rows[0],change);assert.equal(verifyHistoryPublicIdentities(rows).status,"BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING");
  }
});
test("proof, configuration, policy and ignore tampering fail closed",()=>{
  const configuration=readFileSync(new URL("../../.gitleaks.toml",import.meta.url));
  assert.throws(()=>verifyHistoryPublicIdentities(findings,{configuration:Buffer.concat([configuration,Buffer.from("\n# changed")])}),/proof/);
  assert.throws(()=>verifyHistoryPublicIdentities(findings,{policyBytes:Buffer.from("{}")}),/proof/);
  assert.throws(()=>verifyHistoryPublicIdentities(findings,{ignoreBytes:Buffer.from("new ignore")}),/proof/);
  assert.throws(()=>verifyHistoryPublicIdentities(findings,{readGit:(commit,path)=>path.endsWith("snapshot.test.json")?Buffer.from("changed"):git(commit,path)}),/proof/);
});

// Keep the original assertions; run supplemental immutable-checksum negatives in the existing CI entry.
import "./public-source-checksums.test.mjs";
import "./public-task090-identities.test.mjs";
import "./public-task091-identities.test.mjs";
