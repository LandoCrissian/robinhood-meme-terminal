import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import test from "node:test";

const root=new URL("../../",import.meta.url),directory=new URL("docs/evidence/rmt-task078/security/",root);
const bytes=path=>readFileSync(new URL(path,directory));
const json=path=>JSON.parse(bytes(path));
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const register=json("disposition.json");
const highs=r=>r.detectors.filter(row=>row.impact==="High");
test("both all-detector reports bind exact complete compiler inputs and preserve all four unresolved high IDs",()=>{
  const reports={};
  for(const name of ["initial","current"]){
    const entry=register[name],compressed=bytes(entry.report),raw=gunzipSync(compressed),report=JSON.parse(raw);
    assert.equal(sha(compressed),entry.reportSha256);assert.equal(sha(raw),entry.rawReportSha256);
    assert.equal(sha(bytes(entry.input)),entry.compressedInputSha256);assert.equal(sha(gunzipSync(bytes(entry.input))),entry.inputSha256);
    assert.equal(report.inputSha256,entry.inputSha256);assert.equal(report.detectorCount,101);assert.equal(report.sources,3);assert.equal(report.tool,"Slither 0.11.5");
    assert.equal(report.detectors.length,entry.total);assert.equal(highs(report).length,4);assert.equal(entry.strictGateExit,1);reports[name]=report;
  }
  assert.equal(register.initial.total,32);assert.equal(register.current.total,28);
  assert.deepEqual(highs(reports.initial).map(r=>r.id).sort(),highs(reports.current).map(r=>r.id).sort());
  assert.deepEqual(register.rows.map(r=>r.id).sort(),highs(reports.current).map(r=>r.id).sort());
  assert.deepEqual(register.closure.sourceFilters,[]);assert.deepEqual(register.closure.detectorFilters,[]);assert.deepEqual(register.closure.transformations,[]);
});
test("production closure and hostile tests match the exact reviewed source with no suppression annotation",()=>{
  const input=JSON.parse(gunzipSync(bytes(register.current.input)));
  const currentProduction=readdirSync(new URL("packages/contracts/reclaim/src/",root)).filter(p=>p.endsWith(".sol")).map(p=>"reclaim/src/"+p).sort();
  assert.deepEqual(Object.keys(input.sources).sort(),currentProduction);assert.deepEqual(register.closure.roots,currentProduction);
  for(const [path,expected]of register.sourceSha256){
    const source=readFileSync(new URL(path,root),"utf8").replaceAll("\r\n","\n");assert.equal(sha(source),expected,path);
    if(path.includes("/src/")){assert.equal(sha(input.sources[path.replace("packages/contracts/","")].content),expected);assert.doesNotMatch(source,/slither-disable/);}
  }
});
test("every high retains dataflow, actual targeted test and explicit unresolved status",()=>{
  for(const row of register.rows){
    assert.equal(row.detector,"reentrancy-balance");assert.equal(row.cleared,false);assert.match(row.disposition,/UNRESOLVED_GATE$/);
    assert.equal(row.externalCallLine,108);assert.ok([100,105].includes(row.assertionLine));assert.ok(row.preconditions.length>=3);
    for(const proof of [row.test,row.callbackTest]){const [path,name]=proof.split("::");assert.match(readFileSync(new URL(path,root),"utf8"),new RegExp("function "+name+"\\("));}
    assert.match(row.remainingUncertainty,/independent audit/);
  }
});
test("all 28 current findings and the 22 plus six prior highs remain present and separate",()=>{
  const current=JSON.parse(gunzipSync(bytes(register.current.report)));
  assert.equal(register.allFindings.length,28);assert.deepEqual(register.allFindings.map(r=>r.id).sort(),current.detectors.map(r=>r.id).sort());
  for(const prior of register.oldBaselines){const compressed=readFileSync(new URL(prior.path,root));assert.equal(sha(compressed),prior.compressedSha256);const report=JSON.parse(gunzipSync(compressed));assert.deepEqual(highs(report).map(r=>r.id).sort(),prior.highIds);assert.equal(prior.sourceChanged,false);assert.equal(prior.dispositionChanged,false);}
  assert.equal(register.oldBaselines.find(r=>r.scope==="core").highIds.length,22);assert.equal(register.oldBaselines.find(r=>r.scope==="treasury").highIds.length,6);
});
test("actual Foundry evidence includes every test, fuzz runs and stateful funding/custody transitions",()=>{
  const log=bytes(register.foundry.raw).toString("utf8");assert.equal(sha(log),register.foundry.rawSha256);
  assert.equal(register.foundry.tests,37);assert.equal(register.foundry.testNames.length,37);assert.match(log,/37 tests passed, 0 failed, 0 skipped/);
  for(const name of register.foundry.testNames)assert.ok(log.includes("[PASS] "+name+"("),name);
  assert.match(log,/runs: 512/);assert.match(log,/runs: 128, calls: 4096, reverts: 0/);assert.match(log,/redeem721/);assert.match(log,/returnReceipt/);
});
test("custody, fixed-unit and size boundaries never claim burn, live USD conversion or independent clearance",()=>{
  assert.equal(register.custody.mode,"REVERSIBLE_ESCROW_NOT_BURN_NOT_SINK");assert.equal(register.custody.administratorNftWithdrawal,false);
  assert.equal(register.economics.rewardMode,"FIXED_TOKEN_UNITS_ONLY");assert.equal(register.economics.liveUsdQuote,false);assert.equal(register.independentAudit,false);
  assert.equal(register.status,"BLOCKED_NO_BROADCAST");assert.equal(register.productionChanges,false);
  const factory=register.sizes.RMTReclaimFactoryV1,campaign=register.sizes.RMTReclaimCampaignV1;
  assert.equal(factory.runtimeBytes,24009);assert.equal(campaign.runtimeBytes,21278);assert.ok(factory.creationBytes+64<49152);assert.ok(campaign.creationBytes+192<49152);
});
