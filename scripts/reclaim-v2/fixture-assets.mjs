import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {buildReclaimV2Input} from "./compiler.mjs";

export function compileReclaimFixtureAssets({solc}){
  const{manifest}=buildReclaimV2Input({solc}),path="reclaim-v2/test/ReclaimV2Assets.sol";
  const content=readFileSync(new URL("../../packages/contracts/"+path,import.meta.url),"utf8").replaceAll("\r\n","\n");assert.doesNotMatch(content,/\bimport\s/);
  const input=JSON.stringify({language:"Solidity",sources:{[path]:{content}},settings:{...manifest.compilerSettings,outputSelection:{"*":{"*":["abi","evm.bytecode.object","evm.deployedBytecode.object"]}}}});
  const output=JSON.parse(execFileSync(resolve(solc),["--standard-json","--no-import-callback"],{input,encoding:"utf8",timeout:120_000,maxBuffer:8*1024*1024,windowsHide:true,env:process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}}));
  assert.deepEqual((output.errors??[]).filter(e=>e.severity==="error"),[]);
  const artifacts=Object.fromEntries(Object.entries(output.contracts[path]).filter(([,c])=>c.evm.bytecode.object).map(([name,c])=>[name,{abi:c.abi,bytecode:"0x"+c.evm.bytecode.object,runtime:"0x"+c.evm.deployedBytecode.object,immutableReferences:[]}]));
  for(const name of["ReclaimBurn721Fixture","ReclaimBurn1155Fixture","ReclaimSink721Fixture","ReclaimSink1155Fixture","ReclaimFakeBurn721","ReclaimIssuerRecovery721"])assert.ok(artifacts[name]);
  return{artifacts,manifest:{profile:"reclaim-v2-synthetic-nft-assets-only",chainId:31337,productionEligibility:false,source:path,
    sourceSha256:createHash("sha256").update(content).digest("hex"),inputSha256:createHash("sha256").update(input).digest("hex")}};
}
