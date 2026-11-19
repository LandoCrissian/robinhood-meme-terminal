import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {gzipSync,gunzipSync} from "node:zlib";
import {test} from "node:test";
import {buildFindingsRegister,deduplicateRows,registerPath,serializedRegister} from "./findings-register.mjs";

const root=fileURLToPath(new URL("../../",import.meta.url));
const read=path=>readFileSync(new URL("../../"+path,import.meta.url));
const reportPaths=["docs/evidence/fixed-supply-security/slither-4663.json.gz","docs/evidence/rmt-task077/security/slither-v1-reproduced.json.gz","docs/evidence/rmt-task078/security/slither-current.json.gz","docs/evidence/rmt-task079/security/slither-final.json.gz","docs/evidence/rmt-task077/security/slither-v2-prototype.json.gz"];
const reports=reportPaths.map(path=>JSON.parse(gunzipSync(read(path))));
const key=(report,row)=>`${report.analysisInputSha256}:${row.check}:${row.id}`;
const register=buildFindingsRegister();

test("the committed register reconstructs all334 retained rows and all39 high IDs without cross-closure conflation",()=>{
  assert.equal(register.scopes.length,5);assert.equal(register.rawFindingIndex.length,334);assert.equal(register.summary.rawRows,334);assert.equal(register.summary.deduplicatedScopedRows,334);
  const highs=reports.flatMap(report=>report.detectors.filter(row=>row.impact==="High").map(row=>key(report,row))).sort();
  assert.equal(highs.length,39);assert.equal(new Set(highs).size,39);assert.deepEqual(register.findings.filter(row=>row.severity==="High").map(row=>row.key).sort(),highs);
  assert.deepEqual(register.rawFindingIndex.map(row=>`${row.analysisInputSha256}:${row.detector}:${row.findingId}`).sort(),reports.flatMap(report=>report.detectors.map(row=>key(report,row))).sort());
  assert.deepEqual(register.scopes.map(scope=>scope.rawSeverityCounts.High),[22,6,4,7,0]);assert.deepEqual(register.scopes.map(scope=>scope.rawRows),[233,25,28,45,3]);
  assert.equal(register.findings.length,49);assert.equal(register.summary.unregisteredRawRows,285);assert.deepEqual(register.summary.unregisteredSeverityCounts,{High:0,Medium:59,Low:96,Informational:126,Optimization:4});
  assert.equal(register.summary.rawWarningCountIsNotVulnerabilityCount,true);assert.equal(register.summary.clearedHighFindings,0);assert.equal(register.status,"BLOCKED_NO_BROADCAST");
  assert.equal(read(registerPath).toString("utf8").replaceAll("\r\n","\n"),serializedRegister(register));
});

test("all detailed rows retain exact source/call/baseline/assertion evidence and existing regression references",()=>{
  for(const entry of register.findings){const scope=register.scopes.find(scope=>scope.id===entry.scopeId),report=reports[reportPaths.indexOf(scope.report)],raw=report.detectors.find(row=>row.id===entry.findingId);
    assert.ok(raw);assert.equal(raw.check,entry.detector);assert.equal(raw.impact,entry.severity);assert.equal(raw.confidence,entry.confidence);
    const locations=raw.elements.filter(element=>element.type==="function"||element.type==="node");assert.equal(entry.sourceLocations.length,locations.length);
    for(let i=0;i<locations.length;i++){const location=entry.sourceLocations[i],element=locations[i];assert.equal(location.path,"packages/contracts/"+element.source_mapping.filename_short);assert.equal(location.name,element.name);assert.equal(location.firstLine,element.source_mapping.lines[0]);assert.equal(location.lastLine,element.source_mapping.lines.at(-1));assert.match(location.compiledSourceSha256Lf,/^[0-9a-f]{64}$/);}
    if(entry.detector==="reentrancy-balance"){assert.ok(entry.externalCalls.length>0);assert.ok(entry.balanceBaselines.length>0);assert.ok(entry.settlementAssertions.length>0);}
    assert.ok(entry.tests.length>0&&entry.tests.every(path=>read(path.split("::")[0]).length>0));assert.ok(entry.exploitPreconditions.length>0&&entry.existingMitigations.length>0);assert.equal(typeof entry.fundsAtRisk,"string");assert.ok(entry.remainingUncertainty.length>0);
    assert.equal(entry.cleared,false);assert.equal(entry.independentlyResolved,false);assert.equal(entry.releaseGate.overall,"BLOCKED_NO_BROADCAST");assert.equal(entry.releaseGate.ownerApproval,false);assert.equal(entry.releaseGate.paidAuditRequired,false);
    assert.equal(entry.runtimeIdentity.compilerInputSha256,report.inputSha256);assert.equal(entry.runtimeIdentity.analysisInputSha256,report.analysisInputSha256);assert.notEqual(report.inputSha256,report.analysisInputSha256);
  }
});

test("historical return models, internally assessed governance and nonspending prototype cannot clear active custody gates",()=>{
  const governance=JSON.parse(read("docs/evidence/fixed-supply-security/task063-findings.json"));
  assert.deepEqual(register.findings.filter(row=>row.scopeId==="core-and-dependencies-4663"&&row.severity==="Medium").map(row=>row.findingId).sort(),governance.findings.filter(row=>row.impact==="Medium").map(row=>row.id).sort());
  const historical=register.findings.filter(row=>row.scopeId==="reclaim-v1-rejected");assert.equal(historical.length,4);assert.ok(historical.every(row=>row.lifecycle==="REJECTED_HISTORICAL_REVERSIBLE_MODEL"&&row.releaseGate.historicalProductRejected&&row.releaseGate.static==="FAIL_HIGH_RETAINED"));
  const prototype=register.scopes.find(scope=>scope.id==="treasury-v2-nonspending-prototype");assert.equal(prototype.strictHighGateExit,0);assert.equal(prototype.noInheritedClearance,true);assert.equal(prototype.registeredRows,3);
  for(const scope of register.scopes.filter(scope=>scope.id!==prototype.id))assert.equal(scope.strictHighGateExit,1);
  assert.ok(register.findings.filter(row=>row.scopeId===prototype.id).every(row=>row.lifecycle==="NONEXECUTING_NO_CUSTODY_PROTOTYPE"&&row.releaseGate.static==="NO_HIGH_IN_NONEXECUTING_SCOPE_ONLY"));
});

test("exact-ID dedup rejects conflicts and preserves an identical warning from another analysis closure",()=>{
  const report=reports[0],row=structuredClone(report.detectors.find(row=>row.impact==="High"));
  assert.equal(deduplicateRows(report.analysisInputSha256,[row,structuredClone(row)]).length,1);
  assert.throws(()=>deduplicateRows(report.analysisInputSha256,[row,{...row,impact:"Low"}]),/Conflicting/);
  assert.throws(()=>deduplicateRows(report.analysisInputSha256,[row,{...row,description:row.description+"changed"}]),/Conflicting/);
  const second=deduplicateRows("f".repeat(64),[row]);assert.notEqual(second[0].key,deduplicateRows(report.analysisInputSha256,[row])[0].key);
  assert.throws(()=>deduplicateRows("missing",[row]));
});

test("a truncated detector set, removed high row, severity downgrade or changed source cannot regenerate an apparently passing register",()=>{
  const reportPath=reportPaths[3];
  for(const change of [report=>{report.detectorCount=100;},report=>{report.detectors=report.detectors.filter(row=>row.id!==report.detectors.find(row=>row.impact==="High").id);},report=>{report.detectors.find(row=>row.impact==="High").impact="Low";},report=>{report.inputSha256="f".repeat(64);}]){
    const changed=structuredClone(reports[3]);change(changed);const bytes=gzipSync(Buffer.from(JSON.stringify(changed)));
    assert.throws(()=>buildFindingsRegister({read:path=>path===reportPath?bytes:read(path)}));
  }
  const source="packages/contracts/reclaim-v2/src/RMTReclaimCampaignV2.sol";
  assert.throws(()=>buildFindingsRegister({read:path=>path===source?Buffer.concat([read(path),Buffer.from("\n//unreviewed source change\n")]):read(path)}),/Pinned source changed/);
});

test("register check is deterministic and read-only; it neither invokes Slither nor rewrites the retained reports",()=>{
  const hashes=reportPaths.map(path=>createHash("sha256").update(read(path)).digest("hex"));const stored=read(registerPath);
  const result=execFileSync(process.execPath,[fileURLToPath(new URL("./findings-register.mjs",import.meta.url)),"--check"],{cwd:root,encoding:"utf8",windowsHide:true});
  assert.match(result,/334 raw rows,49 detailed records,39 retained highs/);assert.match(result,/BLOCKED_NO_BROADCAST/);
  assert.ok(read(registerPath).equals(stored));assert.deepEqual(reportPaths.map(path=>createHash("sha256").update(read(path)).digest("hex")),hashes);
  assert.equal(serializedRegister(buildFindingsRegister()),serializedRegister(register));
});
