import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";

const here=dirname(fileURLToPath(import.meta.url)),repository=resolve(here,"../../../..");
const read=name=>readFileSync(resolve(here,name));
const json=name=>JSON.parse(read(name));
const sha=value=>createHash("sha256").update(value).digest("hex");
const unzip=name=>gunzipSync(read(name));
const inputHash="de1c5645525e7bc7b1a692974f158fec4e3f62f39a690db37d3377990c66838c";
const source="d01937b1d10310f1faa6e6520691632d3c366af3";
const base="c7e75623ff1163d8c36fd110fc7cf5188b814db1";
const configCanonicalLfSha256="faeee9cdcd16872c6f4a93a776c0dffa5882a0cd628944985d9f70660154db9c";
const configOriginalCrLfSha256="682c4983b955469645ca36b3145f10bd9baa6e3011ac4f8d82cc4de6b49be8cc";
const execution=json("linux-execution.json"),dispositions=json("high-findings.json");
const linux=JSON.parse(unzip("slither-linux.json.gz")),windows=JSON.parse(unzip("slither-windows.json.gz"));
const counts=r=>r.detectors.reduce((a,f)=>(a[f.impact]=(a[f.impact]??0)+1,a),{});
const ids=r=>r.detectors.map(f=>f.id).sort();

function strictReport(r){
  assert.equal(r.inputSha256,inputHash);assert.equal(r.sources,5);assert.equal(r.detectorCount,101);
  assert.equal(r.tool,"Slither 0.11.5");assert.equal(r.cryticCompile,"0.3.11");assert.equal(r.detectors.length,48);
  assert.deepEqual(counts(r),{High:23,Medium:1,Low:15,Informational:9});
  assert.equal(new Set(ids(r)).size,48);
}
function verifyScanConfiguration(text,recordedRawSha256){
  const canonical=text.replaceAll("\r\n","\n");
  assert.ok(!canonical.includes("\r"),"Unexpected lone CR in scanner configuration");
  assert.equal(sha(canonical),configCanonicalLfSha256,"Scanner rules changed");
  // The actual scan used Windows checkout bytes. Preserve that recorded hash;
  // derive precisely those CRLF bytes from the exact pinned LF Git content.
  const originalBytes=canonical.replaceAll("\n","\r\n");
  assert.equal(sha(originalBytes),configOriginalCrLfSha256);
  assert.equal(recordedRawSha256,configOriginalCrLfSha256,"Original scan identity changed");
}

test("exact all-root compiler closure, hashes and immutable template sizes match the recorded review artifact",()=>{
  const bytes=unzip("compiler-input.json.gz"),input=JSON.parse(bytes),m=JSON.parse(unzip("compiler-manifest-linux.json.gz"));
  assert.equal(sha(bytes),inputHash);assert.equal(m.inputSha256,inputHash);assert.equal(m.sourceCount,5);
  assert.deepEqual(Object.keys(input.sources).sort(),m.roots.slice().sort());
  for(const [name,hash]of m.sourceSha256)assert.equal(sha(input.sources[name].content),hash,name);
  assert.equal(input.settings.optimizer.enabled,true);assert.equal(input.settings.optimizer.runs,200);
  assert.equal(input.settings.viaIR,true);assert.equal(input.settings.evmVersion,"cancun");
  assert.equal(m.templates.RMTNftAcquisitionVaultV1.runtimeBytes,21935);
  assert.equal(m.templates.RMTNftAcquisitionFactoryV1.creationBytes,31608);
  assert.equal(execution.sizes.vaultEncodedInitcodeBytes,25640+12*32);
  assert.equal(execution.sizes.factoryEncodedInitcodeBytes,31608+7*32);
  assert.equal(execution.sizes.actualStopCodePartRuntimeBytesEach,1+25640/2);
  assert.ok(execution.sizes.vaultEncodedInitcodeBytes<49152);assert.ok(execution.sizes.factoryEncodedInitcodeBytes<49152);
  assert.equal(execution.sizes.vaultRuntimeHeadroom,24576-21935);
});

test("Linux and retained Windows all-detector reports keep all 23 exact highs unresolved",()=>{
  strictReport(linux);strictReport(windows);assert.deepEqual(ids(linux),ids(windows));
  assert.equal(sha(unzip("slither-linux.json.gz")),"7dacd4318d8b96096c7507f3e24acdbd6cc08322c5d8e3ae0007ee8ddaa735da");
  assert.equal(sha(unzip("slither-windows.json.gz")),"f4162a209492842db29c48ee469140fc1376a0777243e3af05e42976e5a527fe");
  assert.equal(dispositions.sourceCommit,source);assert.equal(dispositions.compilerInputSha256,inputHash);
  assert.equal(dispositions.strictExit,1);assert.equal(dispositions.highs,23);assert.equal(dispositions.independentAudit,false);
  const highs=linux.detectors.filter(f=>f.impact==="High");
  assert.deepEqual(dispositions.findings.map(f=>f.id).sort(),highs.map(f=>f.id).sort());
  for(const f of dispositions.findings){
    const raw=highs.find(r=>r.id===f.id);assert.equal(f.detector,raw.check);assert.equal(f.description,raw.description);
    assert.equal(f.cleared,false);assert.equal(f.confirmedDefect,false);assert.ok(f.boundary.length>40&&f.remainingUncertainty.length>40);
    assert.ok(f.tests.length>0&&f.tests.every(name=>execution.tests.unitTestNames.includes(name)));
  }
  assert.equal(execution.staticAnalysis.strictExit,1);assert.equal(execution.staticAnalysis.highsCleared,0);
  assert.deepEqual(execution.staticAnalysis.detectorFilters,[]);assert.deepEqual(execution.staticAnalysis.sourceFilters,[]);
});

test("strict report validation rejects changed scope, detector count, severity and duplicate identities",()=>{
  for(const mutate of[
    r=>{r.inputSha256="0".repeat(64);},r=>{r.sources=4;},r=>{r.detectorCount=100;},
    r=>{r.detectors.find(f=>f.impact==="High").impact="Low";},r=>{r.detectors[1].id=r.detectors[0].id;},
  ]){const changed=structuredClone(linux);mutate(changed);assert.throws(()=>strictReport(changed));}
  const damaged=read("slither-linux.json.gz").subarray(0,30);assert.throws(()=>gunzipSync(damaged));
});

test("exact Linux Forge fragment proves 30 executed tests and keeps local syntax evidence distinct",()=>{
  const raw=unzip("foundry-linux-fragment.txt.gz"),text=raw.toString("utf8"),local=json("windows-local-reproduction.json");
  assert.equal(execution.sourceCommit,source);assert.equal(execution.baseCommit,base);assert.equal(execution.independentAudit,false);
  assert.equal(execution.broadcastAuthorized,false);assert.equal(execution.compilation,"passed");assert.equal(execution.tools.forge,"1.7.1");
  assert.equal(execution.tests.passed,30);assert.equal(execution.tests.failed,0);assert.equal(execution.tests.skipped,0);
  assert.equal(execution.tests.unitTestNames.length,29);assert.equal(sha(raw),execution.rawEvidence.fragmentSha256);
  assert.equal(raw.length,execution.rawEvidence.fragmentBytes);
  for(const name of execution.tests.unitTestNames)assert.ok(text.includes("[PASS] "+name+"("),name);
  assert.equal((text.match(/\[PASS\] testFuzz\w+\([^)]*\) \(runs: 512,/g)??[]).length,2);
  assert.match(text,/invariantFundsAndCustodyNeverExceedActualSettlement\(\) \(runs: 128, calls: 4096, reverts: 0\)/);
  assert.match(text,/30 tests passed, 0 failed, 0 skipped \(30 total tests\)/);
  assert.equal(local.executedLocally,false);assert.deepEqual(local.syntaxAndTypeAnalysis,{errors:0,warnings:0});
  assert.equal(local.strictExit,1);assert.equal(local.compilerInputSha256,inputHash);
});

test("all 63 preexisting Solidity sources remain identical to the Task080 frozen Git source snapshot",()=>{
  const p=json("source-preservation.json");assert.equal(p.baseCommit,base);assert.equal(p.previousTrackedSolidityFiles,63);
  assert.equal(p.reviewedImplementationCommit,source);assert.deepEqual(p.changed,[]);assert.equal(p.files.length,63);
  assert.equal(new Set(p.files.map(f=>f.path)).size,63);
  for(const f of p.files){
    assert.match(f.gitBlob,/^[0-9a-f]{40}$/);assert.ok(!f.path.startsWith("packages/contracts/nft-acquisition/"));
    const bytes=readFileSync(resolve(repository,f.path),"utf8").replaceAll("\r\n","\n");assert.equal(sha(bytes),f.canonicalSourceSha256,f.path);
  }
});

test("artifact provenance and raw precompression secret scan preserve failed release status",()=>{
  assert.equal(execution.status,"TESTS_PASSED_STATIC_RELEASE_GATE_FAILED");assert.equal(execution.jobConclusion,"failure");
  assert.equal(execution.staticAnalysis.artifactId,14536217941);
  assert.equal(execution.staticAnalysis.artifactArchiveSha256,"b4c0b89ecf1ce29290ec1b9e30fe4ccd6e0c795e64908628b58679d425ddb48f");
  assert.equal(execution.compilerInputSha256,inputHash);assert.equal(execution.secretScan.rawBeforeCompression,true);
  assert.equal(execution.secretScan.version,"8.30.1");assert.equal(execution.secretScan.exit,0);assert.equal(execution.secretScan.findings,0);
  verifyScanConfiguration(readFileSync(resolve(repository,".gitleaks.toml"),"utf8"),execution.secretScan.configSha256);
  const mapping={"nft-acquisition.json":"compiler-input.json.gz","nft-acquisition-manifest.json":"compiler-manifest-linux.json.gz","nft-acquisition-slither.json":"slither-linux.json.gz","slither-windows.json":"slither-windows.json.gz","foundry-linux-fragment.txt":"foundry-linux-fragment.txt.gz"};
  for(const f of execution.rawEvidence.artifacts){const bytes=unzip(mapping[f.file]);assert.equal(bytes.length,f.bytes);assert.equal(sha(bytes),f.sha256);}
});

test("configuration portability accepts only exact pinned LF content and its original CRLF scan identity",()=>{
  const actual=readFileSync(resolve(repository,".gitleaks.toml"),"utf8"),lf=actual.replaceAll("\r\n","\n");
  verifyScanConfiguration(lf,configOriginalCrLfSha256);verifyScanConfiguration(lf.replaceAll("\n","\r\n"),configOriginalCrLfSha256);
  assert.throws(()=>verifyScanConfiguration(lf+"\n# changed rules or source\n",configOriginalCrLfSha256));
  assert.throws(()=>verifyScanConfiguration(lf,configCanonicalLfSha256));
  assert.throws(()=>verifyScanConfiguration(lf,"0".repeat(64)));
  assert.throws(()=>verifyScanConfiguration(lf.replace("\n","\r"),configOriginalCrLfSha256));
});
