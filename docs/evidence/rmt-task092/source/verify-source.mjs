import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
const require=createRequire(new URL("../../../../apps/launch-website/package.json",import.meta.url));
const {keccak256}=require("viem");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
export const sourceIds=["RMTLaunchCurveDeploymentV2","RMTV4CurveInitializationGuardV1","RMTV4CurveGraduationV1","RMTLaunchCurveFactoryV2"];
export function verifySource(metadata,request){
 assert.equal(request.compilerInputSha256,"66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10");
 assert.equal(sha(request.fields.sourceCode),request.compilerInputSha256);
 assert.equal(keccak256(metadata.deployed_bytecode),request.runtimeHash,"Reported deployed runtime differs from original canonical pin");
 assert.equal(keccak256(metadata.creation_bytecode),request.initcodeHash,"Reported creation input differs from original canonical pin");
 const full=metadata.is_fully_verified===true&&metadata.is_partially_verified===false;
 if(!full)return {id:request.id,address:request.address,status:"CANONICAL_INPUT_AND_RUNTIME_MATCH_EXPLORER_SOURCE_PENDING",runtimeHash:request.runtimeHash,initcodeHash:request.initcodeHash,fullyVerified:false};
 const input=JSON.parse(request.fields.sourceCode);
 assert.equal(metadata.compiler_version,request.fields.compilerversion);
 assert.equal(metadata.name,request.id);
 assert.equal(metadata.constructor_args.replace(/^0x/,"").toLowerCase(),request.fields.constructorArguments.replace(/^0x/,"").toLowerCase(),"Constructor arguments differ");
 assert.equal(metadata.evm_version,input.settings.evmVersion);
 assert.equal(metadata.optimization_enabled,input.settings.optimizer.enabled);
 assert.equal(metadata.optimization_runs,input.settings.optimizer.runs);
 for(const key of ["evmVersion","viaIR","optimizer","metadata","remappings"])assert.deepEqual(metadata.compiler_settings[key],input.settings[key],`Compiler setting ${key}`);
 const files=[{file_path:metadata.file_path,source_code:metadata.source_code},...metadata.additional_sources];
 assert.equal(new Set(files.map(file=>file.file_path)).size,files.length,"Duplicate explorer source path");
 for(const file of files)assert.equal(file.source_code,input.sources[file.file_path]?.content,`Source mismatch at ${file.file_path}`);
 assert.equal(metadata.file_path,request.fullyQualifiedName.split(":")[0]);
 return {id:request.id,address:request.address,status:"EXPLORER_FULL_SOURCE_CONSTRUCTOR_INITCODE_RUNTIME_MATCH",fullyVerified:true,
  reportedSourceFiles:files.length,compilerVersion:metadata.compiler_version,verifiedAt:metadata.verified_at,
  constructorBytes:request.fields.constructorArguments.replace(/^0x/,"").length/2,runtimeHash:request.runtimeHash,initcodeHash:request.initcodeHash};
}
export function verifySavedSources(){
 return sourceIds.map((id,index)=>{
  const dir=index===0?"bootstrap-late":index===1?"current":"current-tail";
  const bytes=readFileSync(new URL(`${dir}/${id}.metadata.json.gz`,import.meta.url));
  const report=JSON.parse(readFileSync(new URL(`${dir}/metadata-observation.json`,import.meta.url)));
  const record=report.requests.find(row=>row.id===id);
  assert.equal(record.httpStatus,200);assert.equal(sha(bytes),record.fileSha256);
  const raw=gunzipSync(bytes);assert.equal(sha(raw),record.responseSha256);
  const metadata=JSON.parse(raw),request=JSON.parse(gunzipSync(readFileSync(new URL(`../../rmt-task091/governance/source-publication/${id}.request.json.gz`,import.meta.url))));
  return {...verifySource(metadata,request),observedAt:record.finishedAt,metadataSha256:record.responseSha256};
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const contracts=verifySavedSources();
 const report={schemaVersion:1,scope:"TASK092_OFFLINE_REPLAY_OF_NORMAL_PUBLIC_EXPLORER_METADATA",compilerInputSha256:"66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10",contracts,
  fullyVerified:contracts.filter(row=>row.fullyVerified).length,remaining:contracts.filter(row=>!row.fullyVerified).map(row=>row.id),
  submissionParameterDisposition:"Original per-instance Standard JSON fields match official Blockscout RPC documentation; no demonstrated parameter error",posts:0,signing:false,broadcast:false,deployments:0};
 writeFileSync(new URL("acceptance.json",import.meta.url),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
}
