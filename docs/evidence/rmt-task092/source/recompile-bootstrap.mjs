import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {gzipSync,gunzipSync} from "node:zlib";
import {parseArgs} from "node:util";
import {join,resolve} from "node:path";
import {verifiedSolcExecution} from "../../../../packages/contracts/scripts/pinned-solc.mjs";
const {values}=parseArgs({options:{solc:{type:"string"},output:{type:"string"}}});
assert.ok(values.solc&&values.output);const output=resolve(values.output);assert.ok(!existsSync(output),"Fresh result path required");
const require=createRequire(new URL("../../../../apps/launch-website/package.json",import.meta.url));const {keccak256}=require("viem");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const request=JSON.parse(gunzipSync(readFileSync(new URL("../../rmt-task091/governance/source-publication/RMTLaunchCurveDeploymentV2.request.json.gz",import.meta.url))));
assert.equal(sha(request.fields.sourceCode),request.compilerInputSha256);
const compiler=verifiedSolcExecution({solc:values.solc}),startedAt=new Date().toISOString();
const compiled=JSON.parse(execFileSync(compiler.command,[...compiler.prefix,"--standard-json"],{input:request.fields.sourceCode,encoding:"utf8",maxBuffer:32*1024*1024,timeout:600000,windowsHide:true}));
assert.ok(!compiled.errors?.some(row=>row.severity==="error"),"Original Standard JSON fails native compilation");
const [file,name]=request.fullyQualifiedName.split(":");
const candidates=Object.entries(compiled.contracts).flatMap(([file,contracts])=>Object.entries(contracts).filter(([candidate])=>candidate===name).map(([name,artifact])=>({file,name,artifact})));
assert.equal(candidates.length,1,"Ambiguous short bootstrap name");assert.equal(candidates[0].file,file);
const artifact=compiled.contracts[file][name],original=JSON.parse(gunzipSync(readFileSync(new URL("../../rmt-task090/migration/canonical-compilation.json.gz",import.meta.url))));
assert.equal("0x"+artifact.evm.bytecode.object,original.artifacts[name].bytecode);
assert.equal("0x"+artifact.evm.deployedBytecode.object,original.artifacts[name].runtime);
assert.deepEqual(artifact.evm.deployedBytecode.immutableReferences,original.artifacts[name].immutableOffsets);
assert.equal(keccak256("0x"+artifact.evm.bytecode.object+request.fields.constructorArguments),request.initcodeHash);
const plan=JSON.parse(readFileSync(new URL("../../mobile-signing/protocol-owner-plan.json",import.meta.url)));
const byName=new Map(original.immutableNames),child=contract=>plan.bootstrapChildren.find(row=>row.contract===contract).predictedAddress;
const children={factory:child("RMTLaunchCurveFactoryV2"),graduationEngine:child("RMTV4CurveGraduationV1"),initializationGuard:child("RMTV4CurveInitializationGuardV1")};
const materialized=Buffer.from(artifact.evm.deployedBytecode.object,"hex");
for(const [id,ranges]of Object.entries(artifact.evm.deployedBytecode.immutableReferences))for(const range of ranges){
 assert.equal(range.length,32);const address=children[byName.get(id)];assert.ok(address,"Unexpected bootstrap immutable");
 Buffer.from(address.slice(2).toLowerCase().padStart(64,"0"),"hex").copy(materialized,range.start);
}
assert.equal(keccak256("0x"+materialized.toString("hex")),request.runtimeHash);
const metadata=JSON.parse(gunzipSync(readFileSync(new URL("bootstrap-late/RMTLaunchCurveDeploymentV2.metadata.json.gz",import.meta.url))));
assert.equal("0x"+materialized.toString("hex"),metadata.deployed_bytecode.toLowerCase());
const bytes=gzipSync(JSON.stringify({file,name,artifact}));const artifactPath=join(resolve(output,".."),"bootstrap-native-artifact.json.gz");writeFileSync(artifactPath,bytes,{flag:"wx"});
const report={schemaVersion:1,status:"FRESH_NATIVE_EXACT_INPUT_BOOTSTRAP_INITCODE_AND_IMMUTABLE_RUNTIME_REPRODUCED",startedAt,finishedAt:new Date().toISOString(),compiler,
 compilerInputSha256:request.compilerInputSha256,sourceCodeChanged:false,constructorBytes:request.fields.constructorArguments.length/2,
 shortNameMatches:1,shortNameAndFullyQualifiedNameSelectSameArtifact:true,originalCreationHash:request.initcodeHash,originalRuntimeHash:request.runtimeHash,
 artifact:{file:"bootstrap-native-artifact.json.gz",sha256:sha(bytes),bytes:bytes.length},networkRequests:0,signing:false,broadcast:false,contractDeployment:false};
writeFileSync(output,JSON.stringify(report,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify(report,null,2));
