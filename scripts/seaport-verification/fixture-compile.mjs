import assert from "node:assert/strict";
import{readFileSync,writeFileSync}from"node:fs";
import{execFileSync}from"node:child_process";
import{createHash}from"node:crypto";
import{resolve}from"node:path";
import{fileURLToPath}from"node:url";
import{parseArgs}from"node:util";
import{loadSeaportArtifacts,sourceManifest}from"./provenance-rebuild.mjs";
const sha=value=>createHash("sha256").update(value).digest("hex");
const repository=new URL("../../",import.meta.url);
export function compileSeaportFixtureAssets({solc,includeFoundryTest=false}){
 const binarySha=sha(readFileSync(solc));assert.equal(binarySha,process.platform==="win32"?"537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67":"d5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef");
 const files=["packages/contracts/seaport-verification/test/fixtures/SeaportFixtureReceiver.sol","packages/contracts/nft-acquisition/test/fixtures/NftAcquisitionAssets.sol",...(includeFoundryTest?["packages/contracts/seaport-verification/test/OfficialSeaport.t.sol"]:[])],sources=Object.fromEntries(files.map(path=>[path,{content:readFileSync(new URL(path,repository),"utf8").replaceAll("\r\n","\n")} ]));
 const input=JSON.stringify({language:"Solidity",sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:"cancun",outputSelection:{"*":{"*":["abi","evm.bytecode","evm.deployedBytecode"],"":["ast"]}}}});
 const raw=execFileSync(solc,["--standard-json","--no-import-callback"],{input,encoding:"utf8",maxBuffer:20*1024*1024,timeout:180000,windowsHide:true});const output=JSON.parse(raw);assert.deepEqual((output.errors??[]).filter(e=>e.severity==="error"),[]);const names={};function visit(n){if(!n||typeof n!=="object")return;if(n.nodeType==="VariableDeclaration"&&n.mutability==="immutable")names[n.id]=n.name;for(const c of Object.values(n))if(Array.isArray(c))c.forEach(visit);else if(c&&typeof c==="object")visit(c);}Object.values(output.sources).forEach(x=>visit(x.ast));const artifacts={};for(const contracts of Object.values(output.contracts))for(const[name,a]of Object.entries(contracts)){if(!a.evm.bytecode.object)continue;artifacts[name]={abi:a.abi,creationCode:"0x"+a.evm.bytecode.object,runtimeTemplate:"0x"+a.evm.deployedBytecode.object,immutableReferences:a.evm.deployedBytecode.immutableReferences,immutableNames:names};}
 return{input,artifacts,manifest:{schemaVersion:1,scope:"SYNTHETIC_FIXTURES_NOT_PRODUCTION_CUSTODY_OR_DEPLOYMENT",compilerVersion:"0.8.26+commit.8a97fa7a",compilerSha256:binarySha,inputSha256:sha(input),sources:files.map(path=>({path,sha256:sha(sources[path].content)}))}};
}
export function writeSeaportFixtureArtifacts({solc,output}){const fixture=compileSeaportFixtureAssets({solc});const body={schemaVersion:1,scope:"LOCAL_SYNTHETIC_SEAPORT_FIXTURE_NOT_RELEASE_ARTIFACT",production:false,sourceInputs:{official:sourceManifest.inputs,synthetic:fixture.manifest},artifacts:{...loadSeaportArtifacts(),...fixture.artifacts}};writeFileSync(output,JSON.stringify(body)+"\n");return body;}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const{values}=parseArgs({options:{solc:{type:"string"},output:{type:"string"},"check-foundry-syntax":{type:"boolean"}}});assert.ok(values.solc);if(values["check-foundry-syntax"]){const a=compileSeaportFixtureAssets({solc:resolve(values.solc),includeFoundryTest:true});console.log(JSON.stringify({foundrySyntax:"PASS",inputSha256:a.manifest.inputSha256,contracts:Object.keys(a.artifacts)}));}else{assert.ok(values.output);const a=writeSeaportFixtureArtifacts({solc:resolve(values.solc),output:resolve(values.output)});console.log(JSON.stringify({output:resolve(values.output),syntheticInputSha256:a.sourceInputs.synthetic.inputSha256}));}}
