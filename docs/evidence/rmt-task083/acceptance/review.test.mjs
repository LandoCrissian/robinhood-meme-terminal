import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
const here=new URL("./",import.meta.url),read=p=>readFileSync(new URL(p,here)),json=p=>JSON.parse(read(p)),sha=b=>createHash("sha256").update(b).digest("hex");
const inflate=p=>gunzipSync(read(p),{maxOutputLength:4*1024*1024});
const source="f5a9f40ce2ffb292c8cd12f985158d00416fd3fd";
function assertPublic(r){
 assert.equal(r.scope,"ACTUAL_PUBLIC_BUILD_SEAPORT_EXECUTION_NEGATIVES");assert.equal(r.status,"PASS");assert.equal(r.productionExecution,false);
 assert.deepEqual(r.denied,[{method:"GET",status:404},{method:"HEAD",status:404},{method:"POST",status:404}]);
 assert.deepEqual(r.layouts.map(x=>x.name),["desktop","portrait","landscape"]);
 for(const l of r.layouts){assert.equal(l.noOverflow,true);assert.equal(l.physicalIPhoneAcceptance,false);assert.deepEqual(l.walletCalls,[]);assert.deepEqual(l.externalRequests,[]);assert.deepEqual(l.financialRequests,[]);}
}
test("actual public builds reject execution and make zero wallet calls in six browser layouts",()=>{
 const m=json("public/manifest.json");assert.equal(m.sourceCommit,source);assert.equal(m.productionDeployment,false);assert.equal(m.financialActivation,false);assert.equal(m.scanner.rawBeforeCompression,true);assert.equal(m.scanner.findings,0);assert.deepEqual(json("public/raw-gitleaks.json"),[]);
 const current=readFileSync(new URL("../../../../scripts/seaport-acquisition/public-check.mjs",here),"utf8").replaceAll("\r\n","\n");assert.equal(sha(current),m.scriptGitBytesSha256,"Current script exactly matches the observed source's Git LF bytes");
 assert.equal(m.rawFiles.length,2);for(const f of m.rawFiles){const raw=inflate("public/"+f.name+".gz");assert.equal(raw.length,f.bytes);assert.equal(sha(raw),f.sha256);assertPublic(JSON.parse(raw));}
});
test("public acceptance rejects a successful financial route, wallet discovery, overflow or physical-device overclaim",()=>{
 const original=JSON.parse(inflate("public/chromium-public.json.gz"));
 for(const mutate of[r=>r.denied[2].status=200,r=>r.layouts[0].walletCalls.push("eth_requestAccounts"),r=>r.layouts[1].financialRequests.push("POST /api/seaport-acquisition"),r=>r.layouts[2].noOverflow=false,r=>r.layouts[1].physicalIPhoneAcceptance=true,r=>r.productionExecution=true]){const copy=structuredClone(original);mutate(copy);assert.throws(()=>assertPublic(copy));}
});
test("final strict compiler inputs and all observations retain exact raw bytes and failing severity gate",()=>{
 const m=json("strict/manifest.json");assert.equal(m.sourceCommit,source);assert.equal(m.highsCleared,0);assert.equal(m.productionApproved,false);assert.equal(m.rawBeforeCompression,true);assert.equal(m.rawFindings,0);assert.deepEqual(json("strict/raw-gitleaks.json"),[]);
 for(const f of m.files){const raw=inflate("strict/"+f.name+".gz");assert.equal(raw.length,f.bytes);assert.equal(sha(raw),f.sha256);}
 const c=JSON.parse(inflate("strict/comparison.json.gz")),input=inflate("strict/compiler-input.json.gz"),manifest=JSON.parse(inflate("strict/compiler-manifest.json.gz")),scan=JSON.parse(inflate("strict/slither.json.gz")),old=json("../security/compiler-manifest.json");
 assert.equal(c.sourceHead,source);assert.deepEqual(c.foundry,{passed:48,failed:0,skipped:0,fuzzGroups:2,fuzzRunsEach:512,invariantRuns:128,invariantCalls:4096});assert.equal(c.analysis.strictExit,1);assert.equal(c.analysis.all23HighIdsMatchRetainedWindows,true);assert.equal(c.priorGatesCleared,false);assert.equal(c.postcompilePathDiagnostics.length,4);
 assert.equal(sha(input),"3fbc55312a027e5f69b16fb927c8549efcc6674bab509c792efdc0104083c5f5");assert.equal(manifest.inputSha256,sha(input));assert.equal(scan.inputSha256,sha(input));assert.equal(scan.detectorCount,101);assert.equal(scan.sources,4);assert.equal(scan.detectors.length,48);assert.equal(scan.detectors.filter(x=>x.impact==="High").length,23);
 for(const key of["compilerSettings","roots","sourceCount","sourceSha256","templates"])assert.deepEqual(manifest[key],old[key]);
 assert.equal(c.finalPreservationCheck.oldSolidityFiles,74);assert.equal(c.finalPreservationCheck.oldSolidityChanged,0);
});
