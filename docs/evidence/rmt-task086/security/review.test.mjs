import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
const root=new URL("../../../../",import.meta.url),here=new URL(".",import.meta.url),sha=x=>createHash("sha256").update(x).digest("hex");
const read=p=>readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const delta=JSON.parse(readFileSync(new URL("priority-delta.json",here))),baselineBytes=read(delta.baseline.path),baseline=JSON.parse(baselineBytes);

test("all23 original High identities, calls, baselines, severity and holds remain unchanged",()=>{
 assert.equal(sha(baselineBytes),delta.baseline.sha256);assert.equal(baseline.rows.length,23);assert.equal(delta.rows.length,23);
 assert.equal(delta.baseline.productionInputSha256,"3fbc55312a027e5f69b16fb927c8549efcc6674bab509c792efdc0104083c5f5");
 assert.equal(delta.baseline.detectors,101);assert.equal(delta.baseline.observations,48);assert.equal(delta.baseline.highs,23);assert.equal(delta.baseline.strictExit,1);
 const old=new Map(baseline.rows.map(x=>[x.id,x]));assert.equal(new Set(delta.rows.map(x=>x.id)).size,23);
 for(const row of delta.rows){const original=old.get(row.id);assert.ok(original);for(const k of["detector","rawImpact","rawConfidence","function","source","sourceSha256","externalCall","balanceBaseline","postconditions","internalDisposition"])assert.deepEqual(row[k],original[k],row.id+":"+k);
  assert.equal(row.rawImpact,"High");assert.equal(row.strictHighRetained,true);assert.equal(row.cleared,false);assert.equal(row.confirmedProtocolDefect,false);
  assert.equal(sha(read(row.source.path).toString("utf8").replaceAll("\r\n","\n")),row.sourceSha256);
 }
 assert.deepEqual(delta.separateScopes,{acquisitionV1:22,coreAndDependencies:22,treasuryV1:6,activeReclaimV2:7,rejectedHistoricalReclaimV1:4});
 assert.equal(delta.status,"BLOCKED_NO_BROADCAST");assert.equal(delta.productionSolidityChanged,false);assert.equal(delta.rawDetectorOrSeverityChanged,false);
});

test("prioritization retains every generic path rather than excluding nonnative findings",()=>{
 const counts={};for(const row of delta.rows)counts[row.priority]=(counts[row.priority]??0)+1;
 assert.deepEqual(counts,{P1_NATIVE_ERC721_PURCHASE:4,P2_OTHER_REACHABLE_VAULT_PATH_STILL_UNRESOLVED:15,P1_NATIVE_NOTICE_ACCOUNTING:2,P1_ERC721_EXIT_LIVENESS:2});
 assert.equal(delta.productionCollectionCatalog,"EMPTY_UNAPPROVED");assert.equal(delta.newConfirmedProtocolReserveExtraction,false);
 assert.match(delta.confirmedAdmissionLimitation,/not evidence that the real candidate/);
});

test("actual local full-suite evidence binds the new synthetic test source and compiler",()=>{
 const result=json("docs/evidence/rmt-task086/security/local-foundry.json"),stored=read(result.logPath),log=gunzipSync(stored);
 assert.equal(sha(stored),result.storedLogSha256);
 assert.equal(result.status,"PASS");assert.equal(result.exitCode,0);assert.equal(sha(log),result.logSha256);
 assert.equal(sha(read(delta.newTests.path)),delta.newTests.sha256);assert.equal(result.testSourceSha256,delta.newTests.sha256);
 assert.equal(result.compilerSha256,"537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67");assert.match(result.compilerVersion,/0\.8\.26\+commit\.8a97fa7a/);assert.match(result.forgeVersion,/1\.7\.1/);
 assert.equal(result.productionChanged,false);assert.equal(result.upstreamBroadcast,false);assert.equal(result.realSellerSignatures,false);
 const compilerManifest=json("docs/evidence/rmt-task083/security/compiler-manifest.json");
 assert.equal(sha(gunzipSync(read("docs/evidence/rmt-task083/security/compiler-input.json.gz"))),delta.baseline.productionInputSha256);
 assert.equal(result.productionCompilerInputSha256,delta.baseline.productionInputSha256);
 assert.deepEqual(result.productionSourceSha256,compilerManifest.sourceSha256);
 for(const [path,hash] of result.productionSourceSha256)assert.equal(sha(read("packages/contracts/"+path).toString("utf8").replaceAll("\r\n","\n")),hash);
 for(const name of delta.newTests.names)assert.match(log.toString("utf8"),new RegExp("\\[PASS\\] "+name.split(".")[1]+"\\(\\)"));
 assert.match(log.toString("utf8"),/57 tests passed, 0 failed, 0 skipped/);
});
