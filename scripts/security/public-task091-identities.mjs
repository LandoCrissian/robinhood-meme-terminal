import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {gunzipSync} from "node:zlib";
import {verifyTask090HistoryPublicData} from "./public-task090-identities.mjs";

const repository=fileURLToPath(new URL("../../",import.meta.url));
const proofPath="docs/evidence/rmt-task091/history-adjudication/exact-public-identities.json";
const proofSha256="bff10ba368cd8238b44ec6f97a53bff78a6a20789a57f903f6aff88d71c56903";
const sourceCommit="e36af6bb627a22ca33b8da435dda1ac94b9c49b5";
const sourcePath="docs/evidence/rmt-task091/governance/current/source-publication-attempt.json";
const inputSha256="66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10";
const ids=["RMTLaunchCurveDeploymentV2","RMTV4CurveInitializationGuardV1","RMTV4CurveGraduationV1","RMTLaunchCurveFactoryV2"];
const exactLocations=new Map([26,47,68,89].map((line,index)=>[line,index]));
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const blobSha1=bytes=>createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
const git=(commit,path)=>execFileSync("git",["show",`${commit}:${path}`],{cwd:repository,windowsHide:true,maxBuffer:32*1024*1024});
const descriptor=row=>({fingerprint:typeof row?.Fingerprint==="string"?row.Fingerprint.slice(0,400):"invalid",ruleId:typeof row?.RuleID==="string"?row.RuleID.slice(0,80):"invalid"});

/** Four exact immutable public explorer responses and one exact public source type AFTER the unchanged raw
 * scan. All prior17 records remain delegated to their unchanged verifier. No GUID
 * pattern, future commit/path, scanner rule, ignore or financial gate is allowed. */
export function verifyTask091HistoryPublicData(findings,options={}){
 try{
  assert.ok(Array.isArray(findings)&&findings.length<=1024);
  const {task091ProofBytes=readFileSync(new URL("../../"+proofPath,import.meta.url)),...legacyOptions}=options;
  assert.equal(sha(Buffer.from(task091ProofBytes).toString().replaceAll("\r\n","\n")),proofSha256);
  const policy=JSON.parse(task091ProofBytes);assert.equal(policy.schemaVersion,1);assert.equal(policy.sourceCommit,sourceCommit);assert.equal(policy.records.length,4);
  const cache=new Map(),reader=options.readGit??git;
  const read=(commit,path)=>{const key=commit+":"+path;if(!cache.has(key)){const bytes=reader(commit,path);assert.ok(Buffer.isBuffer(bytes)&&bytes.length<=32*1024*1024);cache.set(key,bytes);}return cache.get(key);};
  const proof=new Map();
  for(const record of policy.records){
   assert.equal(record.commit,sourceCommit);assert.equal(record.path,sourcePath);assert.equal(record.ruleId,"generic-api-key");
   assert.equal(exactLocations.get(record.line),record.requestIndex);assert.equal(record.requestId,ids[record.requestIndex]);
   assert.equal(record.publicKind,"PUBLIC_EXPLORER_VERIFICATION_REQUEST_GUID");
   assert.equal(record.fingerprint,`${sourceCommit}:${sourcePath}:generic-api-key:${record.line}`);
   const source=read(sourceCommit,sourcePath);assert.equal(blobSha1(source),record.gitBlobSha1);assert.equal(sha(source),record.blobSha256);
   const line=source.toString().split(/(?<=\n)/)[record.line-1];assert.equal(sha(line),record.lineSha256);
   const document=JSON.parse(source);assert.equal(document.scope,"TASK091_ROOT_REVIEWED_EXISTING_CONTRACT_SOURCE_PUBLICATION");assert.equal(document.apiKeyUsed,false);
   assert.equal(document.signing,false);assert.equal(document.broadcast,false);assert.equal(document.contractDeployment,false);assert.equal(document.requests.length,4);
   const request=document.requests[record.requestIndex];assert.equal(request.id,record.requestId);assert.equal(request.method,"POST");
   assert.equal(request.url,"https://robinhoodchain.blockscout.com/api?module=contract&action=verifysourcecode");
   assert.equal(request.httpStatus,200);assert.equal(request.apiStatus,"1");assert.equal(request.apiMessage,"OK");
   assert.equal(sha(request.responseBody),record.responseBodySha256);assert.equal(request.responseBodySha256,record.responseBodySha256);
   const response=JSON.parse(request.responseBody);assert.equal(response.message,"OK");assert.equal(response.status,"1");
   const value=response.result;assert.equal(value,request.apiResult);assert.equal(sha(value),record.publicValueSha256);
   assert.equal(value.slice(0,40),request.address.slice(2).toLowerCase());assert.equal(value.length,48);
   assert.ok(line.includes(`"apiResult": "${value}"`));
   const expectedPayloadPath="docs/evidence/rmt-task091/governance/source-publication/"+record.requestId+".request.json.gz";
   assert.equal(record.payloadPath,expectedPayloadPath);const payload=read(sourceCommit,expectedPayloadPath);
   assert.equal(blobSha1(payload),record.payloadGitBlobSha1);assert.equal(sha(payload),record.payloadGzipSha256);assert.equal(request.payloadGzipSha256,record.payloadGzipSha256);
   const decoded=JSON.parse(gunzipSync(payload,{maxOutputLength:2*1024*1024}));
   assert.equal(decoded.id,record.requestId);assert.equal(decoded.address,request.address);assert.equal(decoded.fields.contractaddress,request.address);
   assert.equal(decoded.transport.method,"POST");assert.equal(decoded.transport.url,request.url);
   assert.equal(decoded.fields.codeformat,"solidity-standard-json-input");assert.equal(decoded.fields.compilerversion,"v0.8.26+commit.8a97fa7a");
   assert.equal(decoded.fields.constructorArguments,request.constructorArguments.slice(2));assert.equal(decoded.constructorArguments,request.constructorArguments);
   assert.equal(decoded.runtimeHash,request.runtimeHash);assert.equal(decoded.fields.autodetectConstructorArguments,"false");
   assert.deepEqual(Object.keys(decoded.fields).sort(),["contractaddress","contractname","codeformat","compilerversion","sourceCode","constructorArguments","autodetectConstructorArguments","licenseType"].sort());
   assert.equal(sha(decoded.fields.sourceCode),inputSha256);assert.equal(record.compilerInputSha256,inputSha256);assert.equal(request.compilerInputSha256,inputSha256);
   assert.equal(decoded.createsContract,false);assert.equal(decoded.createsToken,false);assert.equal(decoded.signingAuthorized,false);assert.equal(decoded.broadcastAuthorized,false);
   assert.ok(!proof.has(record.fingerprint));proof.set(record.fingerprint,record);
  }
  assert.equal(proof.size,4);assert.equal(policy.publicTypeProofs.length,1);
  for(const record of policy.publicTypeProofs){
   assert.equal(record.commit,"f5d5edeb728594911aa983202031d14ce1952e18");assert.equal(record.path,"docs/evidence/rmt-task091/validation/classify-scan.mjs");
   assert.equal(record.line,90);assert.equal(record.ruleId,"generic-api-key");assert.equal(record.publicKind,"PUBLIC_SOLIDITY_SOURCE_TYPE");
   assert.equal(record.fingerprint,`${record.commit}:${record.path}:generic-api-key:90`);
   const bytes=read(record.commit,record.path);assert.equal(blobSha1(bytes),record.gitBlobSha1);assert.equal(sha(bytes),record.blobSha256);
   const line=bytes.toString().split(/(?<=\n)/)[record.line-1];assert.equal(sha(line),record.lineSha256);
   assert.equal(record.sourceInputCommit,sourceCommit);assert.equal(record.sourceInputPath,"docs/evidence/rmt-task091/governance/source-publication/solc-standard-input-4663.json.gz");
   const packed=read(record.sourceInputCommit,record.sourceInputPath);assert.equal(blobSha1(packed),record.sourceInputGitBlobSha1);assert.equal(sha(packed),record.sourceInputGzipSha256);
   const input=gunzipSync(packed,{maxOutputLength:2*1024*1024});assert.equal(sha(input),inputSha256);assert.equal(record.compilerInputSha256,inputSha256);
   assert.equal(record.sourceFile,"src/RMTV4CurveGraduationV1.sol");assert.equal(record.sourceLine,114);
   const sourceLine=JSON.parse(input).sources[record.sourceFile].content.split(/(?<=\n)/)[113];assert.equal(sha(sourceLine),record.sourceLineSha256);
   const expression=sourceLine.trim(),type=expression.match(/mapping\(address \w+ => (\w+) \w+\) public \w+;/)?.[1];
   assert.equal(type,record.publicType);assert.equal(sha(type),record.publicValueSha256);assert.ok(line.includes(JSON.stringify(expression)));
   const publicMatch=expression.match(new RegExp("\\w+ => "+type+" "))?.[0];assert.ok(publicMatch);
   assert.equal(sha(publicMatch.replace(type,"REDACTED")),record.redactedMatchSha256);
   assert.ok(!proof.has(record.fingerprint));proof.set(record.fingerprint,record);
  }
  assert.equal(proof.size,5);
  const supplemental=[],legacyRows=[];for(const row of findings)(proof.has(row?.Fingerprint)?supplemental:legacyRows).push(row);
  const legacy=verifyTask090HistoryPublicData(legacyRows,{...legacyOptions,readGit:read});
  const classified=[...legacy.classified],unclassified=[...legacy.unclassified],seen=new Set();
  for(const row of supplemental){const record=proof.get(row.Fingerprint);
   const valid=!seen.has(row.Fingerprint)&&row.RuleID===record.ruleId&&row.Commit===record.commit&&row.File===record.path&&row.StartLine===record.line&&row.EndLine===record.line
    &&row.StartColumn===record.startColumn&&row.EndColumn===record.endColumn&&row.Secret==="REDACTED"&&typeof row.Match==="string"&&sha(row.Match)===record.redactedMatchSha256;
   if(valid){seen.add(row.Fingerprint);classified.push({fingerprint:record.fingerprint,kind:record.publicKind,commit:record.commit,gitBlobSha1:record.gitBlobSha1,lineSha256:record.lineSha256,
    publicValueSha256:record.publicValueSha256,responseBodySha256:record.responseBodySha256,payloadGzipSha256:record.payloadGzipSha256,compilerInputSha256:record.compilerInputSha256});}
   else unclassified.push(descriptor(row));
  }
  const missing=[...legacy.missing,...[...proof.keys()].filter(key=>!seen.has(key))];
  return {...legacy,rawFindingCount:findings.length,classified,unclassified,missing,status:unclassified.length||missing.length?"BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING":"PASSED_EXACT_PUBLIC_DATA_ONLY",
   rawScanPassed:findings.length===0,detectorsChanged:false,ignoreAdded:false,financialSecurityClearance:false,productionAuthorization:false,
   task091Proof:"four-exact-e36af6bb-public-explorer-responses-and-one-f5d5edeb-source-type-v1"};
 }catch{throw Error("Exact Task091 public Git response proof is unavailable or changed");}
}
