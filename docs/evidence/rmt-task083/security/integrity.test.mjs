import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {verifyArtifacts,assertArchiveIntegrity,assertCompilerInput,assertPreserved,assertRootCoverage} from "./verify-artifacts.mjs";
const read=name=>readFileSync(new URL(name,new URL("./",import.meta.url)));

test("Task083 preserves every old Solidity blob, dependencies and retained security gates",async()=>{
 const proof=await verifyArtifacts();assert.equal(proof.preservation.oldSolidityFiles,74);assert.equal(proof.preservation.changed,0);assert.equal(proof.dependencies.changed,0);assert.equal(proof.retainedSecurityGates.changed,0);assert.equal(proof.candidate.sourceClosureCount,4);assert.equal(proof.retainedSecurityGates.strictExit,1);
});
test("preservation rejects old-source deletion, changed content and changed scanner policy",()=>{
 const base=new Map([["old.sol",{mode:"100644",blob:"a"}],[".gitleaks.toml",{mode:"100644",blob:"b"}]]);
 assert.throws(()=>assertPreserved(["old.sol"],base,new Map()),/deleted/);
 assert.throws(()=>assertPreserved(["old.sol"],base,new Map([["old.sol",{mode:"100644",blob:"c"}]])),/changed/);
 assert.throws(()=>assertPreserved([".gitleaks.toml"],base,new Map([[".gitleaks.toml",{mode:"100644",blob:"c"}]])),/changed/);
});
test("every retained compressed/raw evidence artifact matches its exact integrity record",()=>{
 const manifest=JSON.parse(read("integrity.json")),buffers=new Map(manifest.files.map(f=>[f.path,read(f.path)]));assertArchiveIntegrity(buffers,manifest);
});
test("integrity rejects altered report bytes even when they still parse as valid JSON",()=>{
 const manifest=JSON.parse(read("integrity.json")),buffers=new Map(manifest.files.map(f=>[f.path,read(f.path)]));
 const altered=JSON.parse(buffers.get("findings.json"));altered.strictExit=0;buffers.set("findings.json",Buffer.from(JSON.stringify(altered,null,2)+"\n"));assert.throws(()=>assertArchiveIntegrity(buffers,manifest),/Evidence (?:byte count|SHA256)/);
});
test("exact compiler input fails if source bytes or a recorded digest is changed",()=>{
 const manifest=JSON.parse(read("compiler-manifest.json")),bytes=gunzipSync(read("compiler-input.json.gz")),input=JSON.parse(bytes),source=path=>Buffer.from(input.sources[path].content);
 assertCompilerInput(bytes,manifest,source);
 assert.throws(()=>assertCompilerInput(Buffer.from(bytes.toString()+" "),manifest,source),/compiler input digest/);
 assert.throws(()=>assertCompilerInput(bytes,manifest,path=>Buffer.from(source(path).toString()+"\n")),/Current source digest/);
});
test("coverage rejects a new production source omitted from the analysis manifest",()=>{
 const roots=JSON.parse(read("compiler-manifest.json")).roots;assertRootCoverage(roots,roots);assert.throws(()=>assertRootCoverage([...roots,"seaport-acquisition/src/Unreviewed.sol"],roots),/Every current new production root/);
});
