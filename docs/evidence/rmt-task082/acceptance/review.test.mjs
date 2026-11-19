import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {fileURLToPath} from "node:url";

const root=new URL("../../../../",import.meta.url),dir=new URL("./",import.meta.url);
const read=path=>readFileSync(new URL(path,dir));
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const raw=name=>gunzipSync(read(name+".gz"),{maxOutputLength:2*1024*1024});
const data=name=>JSON.parse(raw(name));
const manifest=JSON.parse(read("artifact-manifest.json"));
const preservation=JSON.parse(read("source-preservation.json"));

test("exact source review preserves original core, treasury, Reclaim and dependency boundaries",()=>{
  assert.equal(preservation.validatedSourceCommit,manifest.validatedSourceCommit);
  assert.equal(preservation.productionMutated,false);
  const tree=execFileSync("git",["ls-tree","-r",preservation.baseCommit],{cwd:fileURLToPath(root),windowsHide:true}).toString().trim().split("\n");
  const original=tree.map(line=>line.match(/^\d+ blob ([0-9a-f]{40})\t(.+)$/)).filter(match=>match?.[2].endsWith(".sol"));
  const changed=[];
  for(const[,blob,path] of original){const bytes=Buffer.from(readFileSync(new URL(path,root)).toString().replaceAll("\r\n","\n"));const current=createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");if(current!==blob)changed.push(path);}
  assert.equal(original.length,71);assert.equal(preservation.originalSolidityByteIdentical,70);
  assert.deepEqual(changed,["packages/contracts/nft-acquisition/src/SyntheticNftListingVenueV1.sol"]);
  for(const source of preservation.sourceInputs)assert.equal(sha(Buffer.from(readFileSync(new URL(source.path,root)).toString().replaceAll("\r\n","\n"))),source.sha256);
});

test("actual Linux acquisition report retains all 101 detectors and the same 22 unresolved high IDs",()=>{
  const linux=data("linux-slither.json");const windows=JSON.parse(gunzipSync(readFileSync(new URL("../security/slither-windows.json.gz",dir)),{maxOutputLength:2*1024*1024}));
  assert.equal(linux.detectorCount,101);assert.equal(linux.detectors.length,47);
  assert.equal(linux.inputSha256,"147be8aec26e3d2577b8b2812f2d779d3fc6b39024fd05b7c40397ffddefe6e1");
  const highs=report=>report.detectors.filter(row=>row.impact==="High").map(row=>row.id).sort();
  assert.equal(highs(linux).length,22);assert.deepEqual(highs(linux),highs(windows));
});

test("actual official Seaport receipts remain synthetic and never prove a production custody route",()=>{
  const j=data("seaport-fixture-evidence.json");assert.equal(j.status,"PASS");assert.equal(j.chainId,31337);assert.equal(j.production,false);assert.equal(j.ownerSignatures,false);assert.equal(j.productionRouteSupported,false);
  assert.equal(j.receipts.length,32);assert.equal(j.cases.length,8);assert.ok(Object.values(j.checks).every(value=>value===true));
  for(const c of j.cases){if(c.verified){assert.equal(c.verified.executionEnabled,false);assert.equal(c.verified.routeSupported,false);}}
  const reorg=j.cases.find(c=>c.name==="orphaned-fill-read-only-recovery");assert.equal(reorg.noAutomaticResubmission,true);
});

test("both real browser/PG18.6 journeys retain exact review, restart, trace and reorg evidence",()=>{
  for(const browser of ["chromium","webkit"]){
    const b=data(browser+"-browser.json"),a=data(browser+"-acceptance.json");assert.equal(b.status,"PASS");assert.equal(a.status,"passed");assert.equal(a.chainId,31337);assert.equal(a.productionExecution,false);assert.match(a.postgresql.serverVersion,/^18\.6 /);
    assert.equal(a.restart.unchanged,true);assert.equal(a.restart.before,a.restart.after);assert.equal(a.reorg.custodyAndDatabaseRolledBack,true);assert.equal(a.reorg.paymentRecipientsAndReserveRolledBack,true);assert.equal(a.reorg.noAutomaticRetry,true);
    assert.equal(a.traceRecovery.missingTrace.body.status,"pending");assert.equal(a.traceRecovery.restoredTrace.status,"confirmed");assert.ok(Object.values(a.checks).every(value=>value===true));
    assert.equal(b.policyReviews.length,6);assert.ok(b.policyReviews.every(row=>row.beforeWalletConfirmation));assert.equal(b.pageErrors.length,0);assert.equal(b.forbiddenRequests.length,0);
    assert.equal(b.layouts.length,3);assert.ok(b.layouts.every(row=>row.noOverflow&&row.physicalIPhoneAcceptance===false));
  }
});

test("archived public-data scan is retained and every observation has exact source-bound classification",()=>{
  for(const f of manifest.files){const bytes=raw(f.name);assert.equal(bytes.length,f.bytes);assert.equal(sha(bytes),f.sha256);}
  const reportBytes=raw("raw-public-data-scan.json"),report=JSON.parse(reportBytes);assert.equal(sha(reportBytes),manifest.rawScannerSha256);
  assert.equal(manifest.scanner.rawExit,1);assert.equal(manifest.scanner.unclassified,0);assert.equal(manifest.scanner.detectorsChanged,false);assert.equal(manifest.scanner.financialGateCleared,false);assert.equal(report.length,206);assert.equal(manifest.publicIdentityClassifications.length,report.length);
  for(let i=0;i<report.length;i++){
    const row=report[i],c=manifest.publicIdentityClassifications[i];assert.equal(row.RuleID,c.rule);assert.equal(row.StartLine,c.line);assert.equal(row.EndLine,c.line);assert.equal(row.Secret,"REDACTED");assert.ok(row.File.replaceAll("\\","/").endsWith("/"+c.file));
    const line=raw(c.file).toString().split(/\r?\n/)[c.line-1];assert.equal(sha(line),c.lineSha256);const match=line.match(/^\s*"([a-zA-Z0-9]+)":\s*"(0x[0-9a-fA-F]+|[0-9a-f]{64})"/);assert.ok(match);assert.equal(match[1],c.field);const value=match[2].toLowerCase();assert.equal(sha(value),c.publicValueSha256);
    if(c.binding.publicResponseArchive){assert.equal(c.field,"sourceApiRawSha256");assert.equal(sha(gunzipSync(readFileSync(new URL(c.binding.publicResponseArchive,dir)),{maxOutputLength:8*1024*1024})),value);}
    else {const bound=data(c.binding.file);assert.equal(bound.chainId,31337);const identity=c.binding.path.reduce((v,key)=>v[key],bound);assert.equal(identity.toLowerCase(),value);assert.ok(["token","paymentToken","projectToken","paymentTokenRuntimeHash"].includes(c.field));}
  }
  for(const screenshot of manifest.screenshots){const bytes=read(screenshot.name);assert.equal(bytes.length,screenshot.bytes);assert.equal(sha(bytes),screenshot.sha256);assert.equal(bytes.subarray(1,4).toString(),"PNG");}
});
