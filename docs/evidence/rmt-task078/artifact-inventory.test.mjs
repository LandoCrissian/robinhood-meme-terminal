import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import test from "node:test";

const repository=fileURLToPath(new URL("../../../",import.meta.url));
const directory="docs/evidence/rmt-task078/",inventoryPath=directory+"artifact-inventory.json";
test("Task078 evidence inventory covers every tracked artifact with exact portable bytes",()=>{
  const inventory=JSON.parse(readFileSync(new URL("artifact-inventory.json",import.meta.url),"utf8"));
  assert.equal(inventory.schemaVersion,1);assert.equal(inventory.scope,"TRACKED_TASK078_ARTIFACTS_EXCLUDING_SELF");
  const tracked=execFileSync("git",["ls-files","-z","--",directory],{cwd:repository,encoding:"utf8",windowsHide:true})
    .split("\0").filter(path=>path&&path!==inventoryPath).sort();
  assert.deepEqual(inventory.artifacts.map(row=>row.path),tracked);
  for(const row of inventory.artifacts){
    assert.ok(row.path.startsWith(directory)&&!row.path.includes(".."));
    const bytes=readFileSync(new URL("../../../"+row.path,import.meta.url));
    assert.equal(bytes.length,row.bytes,row.path+" size");
    assert.equal(createHash("sha256").update(bytes).digest("hex"),row.sha256,row.path+" SHA256");
  }
});
