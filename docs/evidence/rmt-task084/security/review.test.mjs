import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {reviewHighs,baseline,baselineReport,INPUT} from "./build-dispositions.mjs";
const source=readFileSync(new URL("../../../../packages/contracts/seaport-acquisition/src/RMTSeaportAcquisitionVaultV2.sol",import.meta.url),"utf8").replaceAll("\r\n","\n");

test("all23 exact High rows retain original ID, source, AST, call, snapshot, assumptions and strict release failure",()=>{
 const r=reviewHighs(baselineReport);assert.equal(r.rows.length,23);assert.equal(r.highsCleared,0);assert.equal(r.confirmedDefects,0);assert.equal(r.productionSourceChanged,false);assert.equal(r.strictExit,1);assert.equal(r.detectorCount,101);assert.equal(r.executionEvidence,null);assert.equal(r.productionPurchasesApproved,false);
 assert.deepEqual(r.counts,{balanceBaseline:22,pinnedNativeFulfillment:1});assert.deepEqual(r.historicalScopes,{acquisitionV1:22,coreAndDependencies:22,treasuryV1:6,activeReclaimV2:7,rejectedHistoricalReclaimV1:4});assert.equal(r.productionInputSha256,INPUT);
 for(const original of baseline.rows){const row=r.rows.find(x=>x.id===original.id);assert.ok(row);assert.equal(row.externalCall,original.externalCall);assert.equal(row.balanceBaseline,original.observedBalance);assert.deepEqual(row.source,original.source);assert.ok(row.astElements.length>0);assert.ok(row.trustAssumptions.length>0);assert.ok(row.assetAndAmountAtRisk.length>0);assert.equal(row.strictHighRetained,true);assert.equal(row.releaseClearance,false);assert.equal(row.independentAudit,false);assert.equal(row.confirmedDefect,false);assert.ok(row.newRegressions.length>0);}
});

test("purchase, funding and native/ERC20/ERC721/ERC1155 withdrawal boundaries remain individually represented",()=>{
 const r=reviewHighs(baselineReport),counts={};for(const row of r.rows)counts[row.function]=(counts[row.function]??0)+1;
 assert.deepEqual(counts,{purchase:13,executeWithdrawal:8,fundToken:2});
 const kinds=new Set(r.rows.map(x=>x.callKind));for(const kind of["EXACT_ALLOWANCE_GRANT","EXACT_ALLOWANCE_REVOCATION","PINNED_TYPED_SEAPORT_FULFILLMENT","ERC721_NOTICED_SAFE_DELIVERY","ERC1155_NOTICED_SAFE_DELIVERY","NOTICED_NATIVE_PAYOUT","CONTROLLER_TOKEN_FUNDING","NOTICED_ERC20_PAYOUT"])assert.ok(kinds.has(kind),kind);
 assert.equal(r.guardedMutableEntryPoints.length,14);assert.match(r.receiverException,/ERC721 transferFrom/);assert.match(r.safeAdminRequirement,/GS013/);
});

test("fresh Linux report correspondence permits only its temporary workspace prefix, not changed source or AST",()=>{
 const linux=JSON.parse(gunzipSync(readFileSync(new URL("../../rmt-task083/security/linux-slither.json.gz",import.meta.url)),{maxOutputLength:4*1024*1024}));
 const r=reviewHighs(linux,{origin:"RETAINED_LINUX_NOT_FRESH_RUN"});assert.equal(r.rows.length,23);assert.equal(r.reportOrigin,"RETAINED_LINUX_NOT_FRESH_RUN");
 const bad=structuredClone(linux);bad.detectors.find(x=>x.impact==="High").elements[0].source_mapping.start++;assert.throws(()=>reviewHighs(bad),/AST\/source/);
});

test("detector omission, severity/ID/description/confidence or compiler/input changes cannot become a disposition pass",()=>{
 for(const change of[
  r=>r.detectorCount=100,r=>r.sources=3,r=>r.tool="Slither 0.11.6",r=>r.compilerSha256="0".repeat(64),r=>r.inputSha256="0".repeat(64),r=>r.analysisInputSha256="0".repeat(64),
  r=>r.detectors.pop(),r=>r.detectors.find(x=>x.impact==="High").impact="Medium",r=>r.detectors.find(x=>x.impact==="High").id="0".repeat(64),
  r=>r.detectors.find(x=>x.impact==="High").description+=" changed",r=>r.detectors.find(x=>x.impact==="High").confidence="High"
 ]){const bad=structuredClone(baselineReport);change(bad);assert.throws(()=>reviewHighs(bad));}
});

test("a changed guard or deleted settlement assertion requires fresh source review instead of inheriting this baseline",()=>{
 for(const changed of[source.replace("entered = 2","entered = 1"),source.replace("s.oldCurrency","s.changedCurrency")])assert.throws(()=>reviewHighs(baselineReport,{vaultSource:changed}),/source revision/);
});

test("new adversarial test references exist, but named tests alone never fabricate execution or clear Highs",()=>{
 const r=reviewHighs(baselineReport),newTests=readFileSync(new URL("../../../../packages/contracts/seaport-acquisition/test/SeaportTask084Security.t.sol",import.meta.url),"utf8");
 const names=new Set(r.rows.flatMap(row=>row.newRegressions.map(t=>t.name)));assert.equal(names.size,6);
 for(const name of names)assert.ok(newTests.includes("function "+name+"("),name);
 for(const row of r.rows)for(const t of row.newRegressions)assert.equal(t.executionStatus,"REQUIRES_SEPARATE_ACTUAL_CI_EVIDENCE");
 assert.equal(r.executionEvidence,null);assert.equal(r.highsCleared,0);assert.equal(r.status,"BLOCKED_NO_BROADCAST");
});
