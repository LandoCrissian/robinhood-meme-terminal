import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {execFileSync} from "node:child_process";
import {parseArgs} from "node:util";
import {resolve} from "node:path";
import {verifiedSolcExecution} from "../../../../packages/contracts/scripts/pinned-solc.mjs";
const {values}=parseArgs({options:{solc:{type:"string"},artifact:{type:"string"},report:{type:"string"}}});assert.ok(values.solc);
const sha=b=>createHash("sha256").update(b).digest("hex");
const p=JSON.parse(gunzipSync(readFileSync(new URL("../../rmt-task091/governance/source-publication/RMTLaunchCurveDeploymentV2.request.json.gz",import.meta.url))));
assert.equal(sha(p.fields.sourceCode),"66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10");
const input=JSON.parse(p.fields.sourceCode),compiler=verifiedSolcExecution({solc:values.solc});
input.settings.outputSelection={"*":{"":["ast"]},"src/RMTLaunchCurveTokenV2.sol":{"RMTLaunchCurveTokenV2":["evm.bytecode","evm.deployedBytecode"]},"src/RMTLaunchCurveRevenueLedgerV1.sol":{"RMTLaunchCurveRevenueLedgerV1":["evm.bytecode","evm.deployedBytecode"]}};
const auxiliaryInput=JSON.stringify(input),output=JSON.parse(execFileSync(compiler.command,[...compiler.prefix,"--standard-json"],{input:auxiliaryInput,encoding:"utf8",windowsHide:true,timeout:300000,maxBuffer:32*1024*1024}));
assert.ok(!output.errors?.some(e=>e.severity==="error"));
const original=JSON.parse(gunzipSync(readFileSync(new URL("../../rmt-task090/migration/canonical-compilation.json.gz",import.meta.url))));
const names=new Map();function walk(node){if(!node||typeof node!=="object")return;if(node.nodeType==="VariableDeclaration"&&node.mutability==="immutable")names.set(String(node.id),node.name);for(const child of Object.values(node))Array.isArray(child)?child.forEach(walk):walk(child);}
for(const source of Object.values(output.sources))walk(source.ast);
const templates={schemaVersion:1,chainId:4663,compilerInputSha256:p.compilerInputSha256,templates:{}};
for(const name of["RMTLaunchCurveTokenV2","RMTLaunchCurveRevenueLedgerV1"]){
 const a=output.contracts[`src/${name}.sol`][name],frozen=original.artifacts[name];
 assert.equal("0x"+a.evm.bytecode.object,frozen.bytecode);assert.equal("0x"+a.evm.deployedBytecode.object,frozen.runtime);
 assert.deepEqual(a.evm.deployedBytecode.immutableReferences,frozen.immutableOffsets);
 const immutableOffsets=Object.fromEntries(Object.entries(a.evm.deployedBytecode.immutableReferences).map(([id,ranges])=>{assert.ok(names.has(id));return[names.get(id),ranges]}));
 templates.templates[name]={runtime:frozen.runtime,immutableOffsets,...(name==="RMTLaunchCurveTokenV2"?{creationBytecode:frozen.bytecode}:{})};
}
assert.deepEqual(Object.keys(templates.templates.RMTLaunchCurveTokenV2.immutableOffsets),[]);
assert.deepEqual(Object.keys(templates.templates.RMTLaunchCurveRevenueLedgerV1.immutableOffsets).sort(),["curve","creator","treasury","treasuryShareBps","operatingRecipient","futureReserveRecipient"].sort());
const bytes=JSON.stringify(templates,null,2)+"\n";
writeFileSync(values.artifact?resolve(values.artifact):new URL("../../../../apps/launch-website/lib/server/production-project-templates.json",import.meta.url),bytes);
const report={schemaVersion:1,status:"CANONICAL_TOKEN_AND_REVENUE_LEDGER_TEMPLATES_REPRODUCED",compiler,canonicalInputSha256:p.compilerInputSha256,
 auxiliaryInputSha256:sha(auxiliaryInput),changes:"AST/output selection only; creation/runtime bytes and immutable offsets equal original canonical compilation",artifactSha256:sha(bytes),artifactBytes:Buffer.byteLength(bytes),networkRequests:0,productionWrites:false};
writeFileSync(values.report?resolve(values.report):new URL("project-template-reproduction.json",import.meta.url),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
