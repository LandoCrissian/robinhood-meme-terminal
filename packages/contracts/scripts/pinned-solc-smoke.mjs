import assert from "node:assert/strict";
import {parseArgs} from "node:util";
import {mkdtempSync,readdirSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {executePinnedSolc,verifiedSolcExecution} from "./pinned-solc.mjs";
const {values}=parseArgs({options:{solc:{type:"string"},emulator:{type:"string"}}});
assert.ok(values.solc,"Supply exact pinned compiler");
const directory=mkdtempSync(join(tmpdir(),"rmt-pinned-solc-execution-"));
const options={solc:values.solc,solcEmulator:values.emulator,solcCache:directory};
const input=JSON.stringify({language:"Solidity",sources:{"Probe.sol":{content:"// SPDX-License-Identifier: MIT\npragma solidity 0.8.26; contract Probe { function f() external pure returns(uint256) { return 89; } }"}},
settings:{outputSelection:{"*":{"*":["abi","evm.bytecode.object"]}}}});
const first=executePinnedSolc(options,input), second=executePinnedSolc(options,input);
assert.equal(first,second);assert.ok(JSON.parse(first).contracts["Probe.sol"].Probe.evm.bytecode.object.length>0);
const files=readdirSync(directory);assert.equal(files.length,1);
const bad=JSON.stringify({language:"Solidity",sources:{"Bad.sol":{content:"pragma solidity 0.8.26; contract {"}},settings:{}});
assert.throws(()=>executePinnedSolc(options,bad),/Compiler returned errors/);
assert.deepEqual(readdirSync(directory),files,"Failed compilation must never enter cache");
const file=join(directory,files[0]),saved=JSON.parse(readFileSync(file,"utf8"));saved.output+=" ";
writeFileSync(file,JSON.stringify(saved));
assert.throws(()=>executePinnedSolc(options,input),/cache output digest mismatch/);
const execution=verifiedSolcExecution(options);
console.log(JSON.stringify({status:"PASS",validCompilation:true,exactCacheReuse:true,compilerFailureRejected:true,failedOutputNotCached:true,corruptCacheRejected:true,
compilerInputSha256:createHash("sha256").update(input).digest("hex"),execution},null,2));
