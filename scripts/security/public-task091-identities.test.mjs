import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {gunzipSync,gzipSync} from "node:zlib";
import {verifyTask091HistoryPublicData} from "./public-task091-identities.mjs";
import {verifyTask090HistoryPublicData} from "./public-task090-identities.mjs";
const root=fileURLToPath(new URL("../../",import.meta.url));
const evidence=new URL("../../docs/evidence/rmt-task091/history-adjudication/",import.meta.url);
const findings=JSON.parse(gunzipSync(readFileSync(new URL("original-history-raw-redacted.json.gz",evidence))));
const proofBytes=readFileSync(new URL("exact-public-identities.json",evidence)),proof=JSON.parse(proofBytes);
const canary=JSON.parse(readFileSync(new URL("../../docs/evidence/rmt-task090/history-adjudication/original-ci-canary-redacted.json",import.meta.url)));
const old17=JSON.parse(gunzipSync(readFileSync(new URL("../../docs/evidence/rmt-task090/history-adjudication/original-ci-history-raw-redacted.json.gz",import.meta.url))));
const commit="e36af6bb627a22ca33b8da435dda1ac94b9c49b5",typeCommit="f5d5edeb728594911aa983202031d14ce1952e18",newIndexes=findings.flatMap((r,i)=>[commit,typeCommit].includes(r.Commit)?[i]:[]);
const cache=new Map();
const git=(commit,path)=>{const key=commit+":"+path;if(!cache.has(key))cache.set(key,execFileSync("git",["show",key],{cwd:root,windowsHide:true,maxBuffer:32*1024*1024}));return cache.get(key);};
const verify=(rows,options={})=>verifyTask091HistoryPublicData(rows,{readGit:git,...options});
const blocked=rows=>assert.equal(verify(rows).status,"BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING");
test("unchanged actual raw22 includes original17, four immutable public response GUIDs and one source-bound type",()=>{
 assert.equal(findings.length,22);assert.equal(newIndexes.length,5);const before=JSON.stringify(findings),result=verify(findings);
 assert.equal(result.status,"PASSED_EXACT_PUBLIC_DATA_ONLY");assert.equal(result.rawFindingCount,22);assert.equal(result.classified.length,22);
 assert.equal(result.classified.filter(r=>r.commit===commit).length,4);assert.deepEqual(result.unclassified,[]);assert.deepEqual(result.missing,[]);
 for(const key of ["rawScanPassed","detectorsChanged","ignoreAdded","financialSecurityClearance","productionAuthorization"])assert.equal(result[key],false);
 assert.equal(JSON.stringify(findings),before);
 assert.equal(result.classified.filter(r=>r.commit===typeCommit).length,1);
 assert.deepEqual(findings.filter(r=>![commit,typeCommit].includes(r.Commit)).map(r=>r.Fingerprint).sort(),old17.map(r=>r.Fingerprint).sort());
 const legacy=verifyTask090HistoryPublicData(findings,{readGit:git});assert.equal(legacy.classified.length,17);assert.equal(legacy.unclassified.length,5);
});
for(let index=0;index<findings.length;index++){
 test(`missing exact observation${index+1} blocks`,()=>blocked(findings.filter((_,i)=>i!==index)));
 test(`duplicate exact observation${index+1} blocks`,()=>blocked([...findings,findings[index]]));
}
for(const index of newIndexes)for(const [name,change]of [
 ["fingerprint",{Fingerprint:findings[index].Fingerprint+":unreviewed"}], ["commit",{Commit:"f".repeat(40)}],
 ["same value in future commit",{Commit:"f".repeat(40),Fingerprint:findings[index].Fingerprint.replace(commit,"f".repeat(40))}],
 ["path",{File:"docs/evidence/rmt-task091/unreviewed.json"}],["line",{StartLine:27}],["end line",{EndLine:27}],
 ["start column",{StartColumn:8}],["end column",{EndColumn:71}],["rule",{RuleID:"another-detector"}],
 ["match",{Match:'api_key = "REDACTED"'}],["nonredacted value",{Secret:"unreviewed"}]
])test(`changed ${name} at exact GUID line${findings[index].StartLine} blocks`,()=>{const rows=structuredClone(findings);Object.assign(rows[index],change);blocked(rows);});
const paths=[...new Set(proof.records.flatMap(r=>[r.path,r.payloadPath]))];
for(const path of paths)test(`immutable blob drift blocks ${path}`,()=>{
 assert.throws(()=>verify(findings,{readGit:(c,p)=>c===commit&&p===path?Buffer.concat([git(c,p),Buffer.from("\n")]):git(c,p)}),/proof/);
});
test("changed actual server response, API status, target prefix, payload digest or canonical input cannot be admitted",()=>{
 const path=proof.records[0].path;
 for(const mutate of [d=>d.requests[0].responseBody='{"message":"OK","status":"1","result":"unreviewed"}',d=>d.requests[0].apiStatus="0",d=>d.requests[0].address="0x"+"9".repeat(40),
  d=>d.requests[0].payloadGzipSha256="0".repeat(64),d=>d.requests[0].compilerInputSha256="0".repeat(64),d=>d.apiKeyUsed=true]){
  assert.throws(()=>verify(findings,{readGit:(c,p)=>{if(c!==commit||p!==path)return git(c,p);const d=JSON.parse(git(c,p));mutate(d);return Buffer.from(JSON.stringify(d));}}),/proof/);
 }
 const payloadPath=proof.records[0].payloadPath;
 assert.throws(()=>verify(findings,{readGit:(c,p)=>{if(c!==commit||p!==payloadPath)return git(c,p);const d=JSON.parse(gunzipSync(git(c,p)));d.fields.sourceCode+="\n";return gzipSync(JSON.stringify(d));}}),/proof/);
});
for(const field of Object.keys(proof.records[0]))test(`pinned proof ${field} drift blocks`,()=>{
 const d=structuredClone(proof);d.records[0][field]="changed";assert.throws(()=>verify(findings,{task091ProofBytes:Buffer.from(JSON.stringify(d))}),/proof/);
});
for(const field of Object.keys(proof.publicTypeProofs[0]))test(`pinned source-type proof ${field} drift blocks`,()=>{
 const d=structuredClone(proof);d.publicTypeProofs[0][field]="changed";assert.throws(()=>verify(findings,{task091ProofBytes:Buffer.from(JSON.stringify(d))}),/proof/);
});
test("changed immutable classifier or original canonical source input cannot admit the public type",()=>{
 const record=proof.publicTypeProofs[0];
 for(const [c,p]of [[record.commit,record.path],[record.sourceInputCommit,record.sourceInputPath]])assert.throws(()=>verify(findings,{readGit:(commit,path)=>commit===c&&path===p?Buffer.concat([git(commit,path),Buffer.from("\n")]):git(commit,path)}),/proof/);
});
test("original detected canary and a new API-key-looking value remain rejected",()=>{
 assert.ok(canary.length);const result=verify([...findings,...canary]);assert.equal(result.status,"BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING");assert.equal(result.classified.length,22);assert.ok(result.unclassified.length>=canary.length);
 blocked([...findings,{Fingerprint:"unreviewed:api-key:1",RuleID:"generic-api-key",Secret:"REDACTED",Match:'api_key = "REDACTED"'}]);
});
test("scanner rules and ignore remain pinned by the unchanged legacy verifier",()=>{
 const configuration=readFileSync(new URL("../../.gitleaks.toml",import.meta.url));
 assert.throws(()=>verify(findings,{configuration:Buffer.concat([configuration,Buffer.from("\n# change")])}),/proof/);
 assert.throws(()=>verify(findings,{ignoreBytes:Buffer.from("new ignore")}),/proof/);
});
test("unknown missing malformed and oversized input fail closed",()=>{assert.throws(()=>verify(null),/proof/);assert.throws(()=>verify(new Array(1025)),/proof/);blocked([]);blocked([{}]);});
