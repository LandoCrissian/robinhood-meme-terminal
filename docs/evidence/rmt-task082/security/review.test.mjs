import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {gunzipSync} from "node:zlib";
import test from "node:test";

const here=new URL("./",import.meta.url),repo=new URL("../../../../",import.meta.url);
const read=name=>readFileSync(new URL(name,here));
const data=name=>JSON.parse(read(name));
const unzip=name=>gunzipSync(read(name),{maxOutputLength:8*1024*1024});
const sha=raw=>createHash("sha256").update(raw).digest("hex");
const register=data("findings.json"),local=data("local-analysis.json");
const report=JSON.parse(unzip("slither-windows.json.gz"));
const compiler=JSON.parse(unzip("compiler-manifest-windows.json.gz"));
const input=JSON.parse(unzip("compiler-input.json.gz"));
const ast=JSON.parse(unzip("ast-boundaries.json.gz"));
const original=JSON.parse(readFileSync(new URL("../../rmt-task081/security/high-findings.json",here)));
const beforeCompiler=JSON.parse(gunzipSync(readFileSync(new URL("../../rmt-task081/security/compiler-manifest-linux.json.gz",here))));
const gitFile=(commit,path)=>execFileSync("git",["show",commit+":"+path],{cwd:fileURLToPath(repo),windowsHide:true});
const normalize=text=>text.replace(/#[0-9]+(?:-[0-9]+)?/g,"#SOURCE").replaceAll("_pay(address,address,address,uint256)","_pay(address,address,uint256)");

function strictReport(value){
  assert.equal(value.tool,"Slither 0.11.5");assert.equal(value.cryticCompile,"0.3.11");
  assert.equal(value.sources,5);assert.equal(value.detectorCount,101);assert.equal(value.inputSha256,register.afterInputSha256);
  assert.equal(value.detectors.length,47);assert.equal(new Set(value.detectors.map(row=>row.id)).size,47);
  const counts=value.detectors.reduce((all,row)=>(all[row.impact]=(all[row.impact]??0)+1,all),{});
  assert.deepEqual(counts,{High:22,Medium:1,Low:15,Informational:9});
}

test("all23 original observations remain individually mapped without a release waiver",()=>{
  assert.equal(register.status,"BLOCKED_NO_BROADCAST");assert.equal(register.independentAudit,false);
  assert.equal(register.baselineCommit,"4892d2af5ac09ae00975c2b799b66bec0d172779");
  assert.equal(register.reviewedSourceCommit,"06e84522f3a920449e364399a74a7a46eb1ac68f");
  assert.equal(register.originalRows,23);assert.equal(register.currentHighs,22);assert.equal(register.currentStrictExit,1);
  assert.deepEqual(register.detectorFilters,[]);assert.deepEqual(register.sourceFilters,[]);assert.deepEqual(register.severityOverrides,[]);
  assert.deepEqual(register.rows.map(row=>row.originalId).sort(),original.findings.map(row=>row.id).sort());
  const testSources=["NftAcquisition.t.sol","NftAcquisitionSecurityReview.t.sol"].map(name=>gitFile(register.reviewedSourceCommit,"packages/contracts/nft-acquisition/test/"+name).toString()).join("\n");
  for(const row of register.rows){
    const before=original.findings.find(finding=>finding.id===row.originalId);assert.equal(row.detector,before.detector);assert.equal(row.functionAndOriginalDescription,before.description);
    assert.equal(row.originalImpact,"High");assert.equal(row.currentStrictGateCleared,false);assert.equal(row.independentSecurityClearance,false);
    assert.equal(row.confirmedReachableAssetLossIdentified,false);assert.equal(row.newTestsExecutedLocally,false);
    assert.ok(row.preconditions.length>60&&row.stateAndSafeguards.length>80&&row.remainingUncertainty.length>100);
    assert.match(row.source.path,/^packages\/contracts\/nft-acquisition\/src\/[^/]+\.sol$/);
    assert.ok(row.minimalAdversarialCases.length>0);for(const name of row.minimalAdversarialCases)assert.ok(testSources.includes("function "+name+"("),name);
  }
});

test("full101-detector actual report keeps21 balance highs and one pinned native-route high",()=>{
  strictReport(report);assert.equal(local.detectors,101);assert.equal(local.strictExit,1);
  const highs=report.detectors.filter(row=>row.impact==="High");
  assert.equal(highs.filter(row=>row.check==="reentrancy-balance").length,21);
  assert.equal(highs.filter(row=>row.check==="arbitrary-send-eth").length,1);
  assert.equal(highs.filter(row=>row.check==="arbitrary-send-erc20").length,0);
  const mapped=register.rows.filter(row=>row.currentObservation);assert.equal(mapped.length,22);
  assert.deepEqual(mapped.map(row=>row.currentObservation.id).sort(),highs.map(row=>row.id).sort());
  assert.equal(mapped.filter(row=>row.originalId===row.currentObservation.id).length,20);
  for(const row of mapped){
    const current=highs.find(finding=>finding.id===row.currentObservation.id);assert.equal(row.currentObservation.description,current.description);
    assert.equal(row.detector,current.check);assert.equal(normalize(row.functionAndOriginalDescription),normalize(current.description));
  }
  const eliminated=register.rows.filter(row=>!row.currentObservation);assert.equal(eliminated.length,1);
  assert.equal(eliminated[0].originalId,"251991d91fae87d18b92781ecf65e3422d77a1de7b0290b43a99558ea7133955");
});

test("actual compiler source closure and bytecode keep Factory/Vault unchanged and only narrow venue payer provenance",()=>{
  const raw=unzip("compiler-input.json.gz");assert.equal(sha(raw),register.afterInputSha256);
  assert.equal(register.afterInputSha256,"147be8aec26e3d2577b8b2812f2d779d3fc6b39024fd05b7c40397ffddefe6e1");
  assert.equal(compiler.inputSha256,register.afterInputSha256);assert.equal(compiler.sourceCount,5);assert.equal(compiler.broadcastAuthorized,false);assert.equal(compiler.coreModified,false);
  assert.equal(compiler.compilerVersion,"0.8.26+commit.8a97fa7a");assert.equal(compiler.executableSha256,"537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67");
  assert.equal(input.settings.evmVersion,"cancun");assert.equal(input.settings.viaIR,true);assert.deepEqual(input.settings.optimizer,{enabled:true,runs:200});
  assert.deepEqual(Object.keys(input.sources).sort(),compiler.roots.slice().sort());
  for(const[path,hash]of compiler.sourceSha256){assert.equal(sha(input.sources[path].content),hash);assert.equal(sha(gitFile(register.reviewedSourceCommit,"packages/contracts/"+path)),hash);}
  for(const name of["RMTNftAcquisitionVaultV1","RMTNftAcquisitionFactoryV1","NftAcquisitionDeployerV1","NftAcquisitionCodePartV1"])assert.deepEqual(compiler.templates[name],beforeCompiler.templates[name]);
  assert.equal(compiler.templates.SyntheticNftListingVenueV1.runtimeBytes,4639);assert.equal(compiler.templates.SyntheticNftListingVenueV1.creationBytes,4896);
  assert.equal(compiler.templates.SyntheticNftListingVenueV1.runtimeSha256,"96cd82f825ac2a3e9c411d7afd74f7891d73f5ee3050c6fea163c885ef20c0c8");
  const changed=compiler.sourceSha256.filter(([path,hash])=>new Map(beforeCompiler.sourceSha256).get(path)!==hash);assert.equal(changed.length,1);assert.equal(changed[0][0],"nft-acquisition/src/SyntheticNftListingVenueV1.sol");
});

test("compiler AST binds actual guards, view interfaces and direct caller-derived payer",()=>{
  assert.equal(ast.inputSha256,register.afterInputSha256);assert.equal(ast.rows.length,75);
  const guarded=ast.rows.filter(row=>row.contract==="RMTNftAcquisitionVaultV1"&&row.modifiers.includes("guarded")).map(row=>row.name).sort();
  assert.deepEqual(guarded,["fundNative","fundToken","configurePolicy","disablePurchases","configureCollection","purchase","scheduleAssetWithdrawal","scheduleNftWithdrawal","cancelWithdrawal","executeWithdrawal","proposeController","acceptController","cancelController"].sort());
  for(const name of["fill","cancel","bumpNonce"]){const f=ast.rows.find(row=>row.contract==="SyntheticNftListingVenueV1"&&row.name===name);assert.ok(f.modifiers.includes("guarded"));}
  for(const[contract,name]of[["INftAcquisitionERC20","balanceOf"],["INftAcquisitionERC20","allowance"],["INftAcquisition721","ownerOf"],["INftAcquisition721","balanceOf"],["INftAcquisition1155","balanceOf"],["INftAcquisitionVenue","orderHash"],["INftAcquisitionVenue","orderState"]])assert.equal(ast.rows.find(row=>row.contract===contract&&row.name===name).stateMutability,"view");
  const pay=ast.rows.find(row=>row.contract==="SyntheticNftListingVenueV1"&&row.name==="_pay"),first=pay.body.statements[0];
  assert.equal(first.nodeType,"VariableDeclarationStatement");assert.equal(first.declarations[0].name,"from");assert.equal(first.initialValue.nodeType,"MemberAccess");assert.equal(first.initialValue.memberName,"sender");assert.equal(first.initialValue.expression.name,"msg");
});

test("raw archives and original zero-finding owned scan are exact and syntax analysis is not runtime acceptance",()=>{
  assert.equal(local.scope,"LOCAL_PINNED_WINDOWS_COMPILER_AND_SLITHER_NOT_EVM_EXECUTION");assert.equal(local.independentAudit,false);assert.equal(local.productionEnabled,false);
  assert.deepEqual(local.testsTypechecked,{sourceFiles:9,errors:0,warnings:0,EvmExecution:false});
  for(const row of local.files){const compressed=read(row.path);assert.equal(compressed.length,row.bytes);assert.equal(sha(compressed),row.sha256);const raw=unzip(row.path);assert.equal(raw.length,row.uncompressedBytes);assert.equal(sha(raw),row.uncompressedSha256);}
  assert.equal(local.rawSecretScan.version,"8.30.1");assert.equal(local.rawSecretScan.rawBeforeCompression,true);assert.equal(local.rawSecretScan.findings,0);assert.equal(local.rawSecretScan.exit,0);
  assert.deepEqual(data("raw-gitleaks-report.json"),[]);assert.equal(sha(read("raw-gitleaks-report.json")),local.rawSecretScan.rawReportSha256);
  const config=gitFile(register.baselineCommit,".gitleaks.toml").toString();assert.ok([sha(config),sha(config.replaceAll("\n","\r\n"))].includes(local.rawSecretScan.configurationSha256));
});

test("strict validation rejects detector omission, severity manipulation, duplicates and altered compiler identity",()=>{
  for(const mutate of[r=>r.detectorCount=100,r=>r.sources=4,r=>r.detectors.find(row=>row.impact==="High").impact="Low",r=>r.detectors[1].id=r.detectors[0].id,r=>r.inputSha256="0".repeat(64)]){
    const changed=structuredClone(report);mutate(changed);assert.throws(()=>strictReport(changed));
  }
});
