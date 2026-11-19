import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

const repository=fileURLToPath(new URL("../../../",import.meta.url)),directory="docs/evidence/rmt-task079/",self=directory+"artifact-inventory.json";
test("Task079 inventory binds every tracked artifact with explicit portable normalization",()=>{
  const inventory=JSON.parse(readFileSync(new URL("artifact-inventory.json",import.meta.url),"utf8"));
  assert.equal(inventory.schemaVersion,1);assert.equal(inventory.scope,"TRACKED_TASK079_ARTIFACTS_EXCLUDING_SELF");assert.equal(inventory.productionAuthorization,false);
  const tracked=execFileSync("git",["ls-files","-z","--",directory],{cwd:repository,encoding:"utf8",windowsHide:true}).split("\0").filter(file=>file&&file!==self).sort();
  assert.deepEqual(inventory.artifacts.map(row=>row.path),tracked);
  for(const row of inventory.artifacts){
    assert.ok(row.path.startsWith(directory)&&!row.path.includes("..")&&!row.path.includes("\\"));assert.match(row.sha256,/^[0-9a-f]{64}$/);assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>0);
    let bytes=readFileSync(new URL("../../../"+row.path,import.meta.url));
    if(/\.(?:gz|png)$/.test(row.path))assert.equal(row.normalization,"binary");else{assert.equal(row.normalization,"canonical-lf");const text=bytes.toString("utf8");assert.ok(Buffer.from(text,"utf8").equals(bytes),"Canonical text must be valid UTF8");bytes=Buffer.from(text.replaceAll("\r\n","\n"),"utf8");}
    assert.equal(bytes.length,row.bytes,row.path+" normalized size");assert.equal(createHash("sha256").update(bytes).digest("hex"),row.sha256,row.path+" normalized SHA256");
  }
});
