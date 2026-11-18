import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import test from "node:test";
import {gunzipSync} from "node:zlib";

const root = new URL("../../../", import.meta.url);
const json = name => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
test("Task077 preserves all 42 prior Solidity files and keeps V1/core compiler identities separate", () => {
  const frozen=json("frozen-source-manifest.json");
  assert.equal(frozen.baseCommit,"ecf3998f6e9b556c000de5c48908e4fb0b363fc8");
  assert.equal(frozen.unchangedBaseSolidityFiles,42);assert.equal(frozen.originalSolidity.length,42);
  for(const file of frozen.originalSolidity) assert.equal(sha(readFileSync(new URL(file.path,root),"utf8").replaceAll("\r\n","\n")),file.sha256,file.path);
  assert.equal(frozen.core31337InputSha256,json("chromium-core.json").sourceIdentity.coreCompiler.inputSha256);
  assert.equal(frozen.treasuryV1InputSha256,json("chromium-core.json").moduleCompiler.inputSha256);
});
test("the complete nonspending prototype compiler closure matches fresh all-detector analysis", () => {
  const manifest=json("compiler-manifest.json"),input=gunzipSync(readFileSync(new URL("compiler-input.json.gz",import.meta.url)));
  assert.equal(sha(input),manifest.inputSha256);assert.equal(manifest.inputSha256,"02d430dc4018a9a75c9c69f204c4e94c57fa8b94722c90effc79293cad7fff7d");
  const parsed=JSON.parse(input);assert.equal(Object.keys(parsed.sources).length,3);assert.deepEqual(Object.keys(parsed.sources).sort(),manifest.roots);
  for(const [path,expected] of manifest.sourceSha256){assert.equal(sha(parsed.sources[path].content),expected);assert.equal(sha(readFileSync(new URL("packages/contracts/"+path,root),"utf8").replaceAll("\r\n","\n")),expected);}
  assert.deepEqual(manifest.transformations,[]);assert.equal(manifest.broadcastAuthorized,false);
  for(const template of Object.values(manifest.templates)){assert.ok(template.runtimeBytes<24576);assert.ok(template.creationBytes+320<49152);}
  const security=json("security/disposition.json");assert.equal(security.v2Prototype.inputSha256,manifest.inputSha256);
  assert.equal(security.v2Prototype.executable,false);assert.equal(security.v2Prototype.v1FindingsRemediated,false);
});
test("both actual synthetic journeys bind nonspending refusals to real treasury, migration, Safe and v4 evidence", () => {
  for(const engine of ["chromium","webkit"]){
    const core=json(engine+"-core.json"),ui=json(engine+"-browser.json"),prototype=json(engine+"-v2.json");
    assert.equal(core.status,"passed");assert.equal(core.chainId,31337);assert.equal(core.productionExecution,false);
    assert.equal(core.sourceIdentity.commit,"dc6b3d6422245a5da8f631e2fd993a5a36c7c8a5");
    assert.equal(core.receipts.length,53);assert.equal(core.receipts.filter(r=>r.status==="reverted").length,8);
    assert.ok(Object.values(core.checks).every(v=>v===true));assert.equal(core.purchaseTransactions,0);
    assert.equal(ui.status,"passed");assert.equal(ui.sends.length,4);assert.equal(ui.recoveries.length,3);assert.equal(ui.layouts.length,7);
    assert.equal(ui.completedCreationArchives.length,2);assert.deepEqual(ui.pageErrors,[]);assert.deepEqual(ui.externalRequests,[]);
    assert.equal(ui.desktopRead.indexed,true);assert.equal(ui.desktopRead.walletRequests,0);
    assert.equal(prototype.status,"NOT_EXECUTABLE");assert.equal(prototype.phase,"graduated");assert.equal(prototype.purchaseTransactions,0);
    assert.equal(prototype.independentReferenceAdmitted,false);assert.equal(prototype.physicalIPhoneAcceptance,false);
    assert.equal(prototype.compiler.inputSha256,json("compiler-manifest.json").inputSha256);
    assert.equal(prototype.sourceIdentity.commit,core.sourceIdentity.commit);assert.equal(prototype.receipts.length,5);
    for(const receipt of prototype.receipts){assert.equal(receipt.status,"success");assert.equal(receipt.transaction.valueWei,"0");assert.ok(core.receipts.some(row=>row.transactionHash===receipt.transactionHash));}
    assert.equal(prototype.rejections.length,15);assert.ok(prototype.rejections.every(row=>row.simulationOnly));
    assert.ok(Object.values(prototype.checks).every(v=>v===true));assert.equal(Object.keys(prototype.checks).length,10);
    assert.equal(prototype.migration.entitlementMigration,false);assert.equal(prototype.rotation.oldIntentEffective,false);
    assert.equal(prototype.graduation.poolKey.fee,3000);assert.equal(prototype.graduation.poolKey.tickSpacing,60);
    assert.equal(BigInt(prototype.graduation.poolKey.hooks)&0x3fffn,0x2000n);assert.ok(BigInt(prototype.graduation.liquidity)>0n);
  }
});
test("public Chromium/WebKit expose no buy authority, wallet requests, fabricated assets or successful financial routes", () => {
  for(const engine of ["chromium","webkit"]){
    const report=json(engine+"-public.json");assert.equal(report.status,"PASS");assert.equal(report.physicalIPhoneAcceptance,false);
    assert.equal(report.capability.status,"NOT_EXECUTABLE");assert.equal(report.capability.spendingAuthority,false);assert.equal(report.capability.deployed,false);
    assert.equal(report.missingEvidenceIsUnavailable,true);assert.equal(report.denied.length,3);assert.ok(report.denied.every(row=>row.status===404));
    assert.equal(report.layouts.length,3);for(const layout of report.layouts){assert.equal(layout.walletRequests,0);assert.equal(layout.externalRequests,0);assert.equal(layout.operationalRequests,0);assert.deepEqual(layout.errors,[]);assert.equal(layout.noOverflow,true);assert.equal(layout.capturePreservesEmulation,true);assert.equal(layout.keyboardAccessible,true);assert.ok(layout.summaryHeight>=44);}
  }
});
test("retained raw artifacts and screenshots keep exact, portable checksums", () => {
  const files=json("files.sha256.json").files;assert.ok(files.length>20);
  for(const file of files){assert.match(file.path,/^[a-zA-Z0-9._/-]+$/);assert.ok(!file.path.startsWith("/")&&!file.path.includes(".."));assert.equal(sha(readFileSync(new URL(file.path,import.meta.url))),file.sha256,file.path);}
});
