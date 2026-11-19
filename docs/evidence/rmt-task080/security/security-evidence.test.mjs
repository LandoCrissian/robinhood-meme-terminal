import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {gunzipSync} from "node:zlib";
import {test} from "node:test";

const root=fileURLToPath(new URL("../../../../",import.meta.url)),base="526cf004d267596f6203f977be40439825f1204b";
const read=name=>readFileSync(new URL(name,import.meta.url));
const json=name=>JSON.parse(read(name).toString("utf8"));
const unpack=name=>gunzipSync(read(name),{maxOutputLength:4*1024*1024});
const sha=value=>createHash("sha256").update(value).digest("hex");
const lf=value=>Buffer.from(value.toString("utf8").replaceAll("\r\n","\n"));
const repoRead=path=>readFileSync(new URL("../../../../"+path,import.meta.url));
const reproduction=json("reproduction.json"),execution=json("linux-execution.json"),manifest=json("compiler-manifest.json");
const inputBytes=unpack("compiler-input.json.gz"),reportBytes=unpack("slither-full.json.gz"),input=JSON.parse(inputBytes),report=JSON.parse(reportBytes);
const previous=JSON.parse(gunzipSync(readFileSync(new URL("../../rmt-task079/security/slither-final.json.gz",import.meta.url))));
const idSet=report=>report.detectors.map(row=>`${row.check}:${row.id}:${row.impact}:${row.confidence}`).sort();

test("actual Linux static-report bytes retain the same full compiler closure,45 IDs and7 unresolved highs",()=>{
  const bytes=unpack("slither-linux.json.gz"),linux=JSON.parse(bytes),linuxManifest=json("compiler-manifest-linux.json");
  assert.equal(sha(bytes),execution.staticAnalysis.reportSha256);assert.equal(linux.inputSha256,execution.compilerInputSha256);assert.equal(linux.analysisInputSha256,execution.staticAnalysis.analysisInputSha256);
  assert.equal(linux.tool,"Slither 0.11.5");assert.equal(linux.cryticCompile,"0.3.11");assert.equal(linux.detectorCount,101);assert.equal(linux.sources,6);assert.equal(linux.detectors.length,45);
  assert.deepEqual(idSet(linux),idSet(report));assert.deepEqual(idSet(linux),idSet(previous));assert.equal(linux.detectors.filter(row=>row.impact==="High").length,7);
  assert.equal(linux.compilerSha256,execution.tools.solcExecutableSha256);assert.equal(linuxManifest.executableSha256,execution.tools.solcExecutableSha256);assert.equal(linuxManifest.executablePlatform,"linux-x64");
  assert.equal(linuxManifest.inputSha256,sha(inputBytes));assert.deepEqual(linuxManifest.sourceSha256,manifest.sourceSha256);assert.deepEqual(linuxManifest.compilerSettings,manifest.compilerSettings);assert.deepEqual(linuxManifest.transformations,[]);
  assert.equal(linuxManifest.status,"BLOCKED_NO_BROADCAST");assert.equal(linuxManifest.broadcastAuthorized,false);assert.equal(linuxManifest.coreModified,false);
});

test("fresh local full-closure analysis binds exact archived inputs and retains every Task079 detector ID",()=>{
  const expected="fece6e205ff52f8369c732cbddaa663a0d19530062b7539dc4b4467099a08cdc";
  assert.equal(sha(inputBytes),expected);assert.equal(manifest.inputSha256,expected);assert.equal(report.inputSha256,expected);assert.equal(reproduction.productionInputSha256,expected);assert.equal(execution.compilerInputSha256,expected);
  assert.equal(sha(reportBytes),reproduction.analysis.rawReportSha256);assert.equal(report.analysisInputSha256,reproduction.analysis.analysisInputSha256);
  assert.equal(report.tool,"Slither 0.11.5");assert.equal(report.cryticCompile,"0.3.11");assert.equal(report.detectorCount,101);assert.equal(report.sources,6);assert.equal(report.detectors.length,45);assert.equal(new Set(report.detectors.map(row=>row.id)).size,45);
  assert.deepEqual(idSet(report),idSet(previous));assert.equal(report.detectors.filter(row=>row.impact==="High").length,7);
  const counts=Object.fromEntries(["High","Medium","Low","Informational","Optimization"].map(severity=>[severity,report.detectors.filter(row=>row.impact===severity).length]));
  assert.deepEqual(counts,{High:7,Medium:1,Low:29,Informational:7,Optimization:1});assert.deepEqual(counts,reproduction.analysis.counts);assert.deepEqual(counts,execution.staticAnalysis.counts);
  assert.deepEqual(reproduction.scope.detectorFilters,[]);assert.deepEqual(reproduction.scope.sourceFilters,[]);assert.deepEqual(reproduction.scope.sourceTransformations,[]);assert.deepEqual(manifest.transformations,[]);
  assert.deepEqual(Object.keys(input.sources).sort(),manifest.sourceSha256.map(([file])=>file).sort());
  for(const[file,hash]of manifest.sourceSha256){assert.equal(sha(Buffer.from(input.sources[file].content)),hash);assert.equal(sha(lf(repoRead("packages/contracts/"+file))),hash);}
  assert.equal(report.compilerSha256,reproduction.tools.solcSha256);assert.equal(manifest.executableSha256,reproduction.tools.solcSha256);
});

test("new boundary regressions are bound to current test source while native execution remains explicitly unperformed",()=>{
  assert.equal(reproduction.tests.executedLocally,false);assert.match(reproduction.tests.reason,/native Forge executable/);assert.match(reproduction.tests.localSyntaxAndTypeAnalysis.scope,/not actual EVM execution/);
  const testSource=lf(repoRead(reproduction.tests.newTestFile));assert.equal(sha(testSource),reproduction.tests.sourceSha256);assert.equal(sha(testSource),execution.tests.newBoundarySourceSha256);
  const defined=[...testSource.toString("utf8").matchAll(/\bfunction\s+(test[A-Za-z0-9_]+)\s*\(/g)].map(match=>match[1]).sort();
  assert.equal(defined.length,18);assert.deepEqual(defined,[...reproduction.tests.names].sort());assert.deepEqual(defined,[...execution.tests.newBoundaryTestNames].sort());
  assert.equal(reproduction.tests.newTests,18);assert.equal(execution.tests.newBoundaryTestsPassed,18);
});

test("exact original Linux Forge log proves55 passes,18 new cases,two512-run fuzz cases and4096 invariant calls",()=>{
  const bytes=unpack("foundry-linux-fragment.txt.gz");assert.equal(bytes.length,execution.evidence.uncompressedFragmentBytes);assert.equal(sha(bytes),execution.evidence.uncompressedFragmentSha256);
  const log=bytes.toString("utf8").replace(/\u001b\[[0-9;]*m/g,"");
  const passes=[...log.matchAll(/\[PASS\]\s+([A-Za-z0-9_]+)\(([^)]*)\)/g)].map(match=>({name:match[1],signature:match[1]+"("+match[2]+")"}));
  assert.equal(passes.length,55);assert.equal(new Set(passes.map(row=>row.signature)).size,55);assert.doesNotMatch(log,/\[(?:FAIL|SKIP)\]/);
  const summaries=[...log.matchAll(/Suite result: ok\. ([0-9]+) passed; ([0-9]+) failed; ([0-9]+) skipped;/g)];
  assert.equal(summaries.length,4);assert.equal(summaries.reduce((sum,match)=>sum+Number(match[1]),0),55);assert.ok(summaries.every(match=>match[2]==="0"&&match[3]==="0"));
  assert.match(log,/55 tests passed, 0 failed, 0 skipped \(55 total tests\)/);assert.deepEqual({passed:execution.tests.passed,failed:execution.tests.failed,skipped:execution.tests.skipped},{passed:55,failed:0,skipped:0});
  for(const name of execution.tests.newBoundaryTestNames)assert.equal(passes.filter(row=>row.name===name).length,1,name+" actually passed");
  assert.equal(execution.tests.fuzz.length,2);for(const fuzz of execution.tests.fuzz){assert.equal(fuzz.runs,512);assert.ok(log.includes("[PASS] "+fuzz.name+" (runs: 512,"));}
  assert.equal(execution.tests.invariant.runs,128);assert.equal(execution.tests.invariant.depth,32);assert.equal(execution.tests.invariant.calls,4096);assert.equal(execution.tests.invariant.reverts,0);
  assert.ok(log.includes("[PASS] "+execution.tests.invariant.name+" (runs: 128, calls: 4096, reverts: 0)"));
  assert.equal(execution.scope,"ISOLATED_SYNTHETIC_EVM_NOT_PRODUCTION_OR_PHYSICAL_WALLET");assert.equal(execution.tools.foundry,"1.7.1");assert.equal(execution.tools.solc,"0.8.26+commit.8a97fa7a");assert.match(execution.ciJobUrl,/\/actions\/runs\/[0-9]+\/job\/[0-9]+$/);
});

test("all62 previously tracked Solidity files remain identical to the actual Git baseline without dependency materialization",()=>{
  const preservation=json("source-preservation.json");assert.equal(preservation.baseCommit,base);assert.equal(preservation.previousTrackedSolidityFiles,62);assert.deepEqual(preservation.changed,[]);
  const tracked=execFileSync("git",["ls-tree","-rz","--name-only",base],{cwd:root,encoding:"utf8",windowsHide:true}).split("\0").filter(path=>path.endsWith(".sol")).sort();
  assert.equal(tracked.length,62);assert.deepEqual(preservation.files.map(row=>row.path).sort(),tracked);assert.equal(tracked.includes(reproduction.tests.newTestFile),false,"New boundary test is additional evidence, not a frozen-source replacement");
  for(const row of preservation.files){assert.ok(!row.path.includes("..")&&!row.path.includes("\\"));const baseline=execFileSync("git",["cat-file","blob",base+":"+row.path],{cwd:root,windowsHide:true});
    const blob=createHash("sha1").update("blob "+baseline.length+"\0").update(baseline).digest("hex");assert.equal(blob,row.gitBlob,row.path+" actual baseline Git identity");
    assert.equal(sha(lf(baseline)),row.canonicalSourceSha256);assert.equal(sha(lf(repoRead(row.path))),row.canonicalSourceSha256,row.path+" current source preservation");
  }
});

test("passing synthetic execution never clears local or Linux high gates or becomes an independent audit",()=>{
  assert.equal(reproduction.status,"BLOCKED_NO_BROADCAST");assert.equal(reproduction.independentAudit,false);assert.equal(reproduction.productionSourceChanged,false);assert.equal(reproduction.analysis.strictExit,1);assert.equal(reproduction.analysis.findings,45);
  assert.equal(reproduction.findings.length,7);assert.ok(reproduction.findings.every(row=>row.impact==="High"&&row.cleared===false));
  assert.equal(execution.status,"TESTS_PASSED_STATIC_RELEASE_GATE_FAILED");assert.equal(execution.jobConclusion,"failure");assert.equal(execution.failureStep,"Run all 101 detectors and fail on any V2 high");
  assert.equal(execution.staticAnalysis.all101Detectors,true);assert.deepEqual(execution.staticAnalysis.sourceOrDetectorFilters,[]);assert.equal(execution.staticAnalysis.productionSourceChanged,false);assert.equal(execution.staticAnalysis.strictExit,1);assert.equal(execution.staticAnalysis.cleared,false);
  assert.equal(execution.staticAnalysis.analysisInputSha256,report.analysisInputSha256);assert.match(execution.staticAnalysis.reportSha256,/^[0-9a-f]{64}$/);
  // Both native and Linux raw reports are independently bound to their own
  // recorded hashes above; neither platform's bytes substitute for the other.
  assert.equal(execution.evidence.gitleaks.scannedRawBeforeCompression,true);assert.equal(execution.evidence.gitleaks.exit,0);assert.equal(execution.evidence.gitleaks.findings,0);
  // The recorded scan ran against the native Windows CRLF checkout. Recreate
  // those exact bytes after canonicalization so Git's LF checkout is portable.
  // This is line-ending equivalence, not another scanner execution or clearance.
  assert.equal(sha(lf(repoRead(".gitleaks.toml"))),"faeee9cdcd16872c6f4a93a776c0dffa5882a0cd628944985d9f70660154db9c");
  const scannerConfig=lf(repoRead(".gitleaks.toml")).toString("utf8").replaceAll("\n","\r\n");
  assert.equal(sha(Buffer.from(scannerConfig)),execution.evidence.gitleaks.configSha256);assert.equal(sha(Buffer.from(scannerConfig)),reproduction.secretScan.configSha256);assert.deepEqual(json("gitleaks-report.json"),[]);
});
