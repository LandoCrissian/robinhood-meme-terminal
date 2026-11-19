import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {existsSync,readFileSync,readdirSync} from "node:fs";
import test from "node:test";

const root=new URL("../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8").replaceAll("\r\n","\n");
const sha=text=>createHash("sha256").update(text).digest("hex");
test("permanent V2 has its own unfiltered strict job and leaves the full historical security workflow unchanged",()=>{
  const previous=read(".github/workflows/security-analysis.yml");
  assert.equal(sha(previous),"33eb258db57b57fef26b4fdd1048f29af6b240a25b0369bd8a38091bdc79a828");
  const workflow=read(".github/workflows/reclaim-v2-security.yml");
  assert.match(workflow,/reclaim-permanent-v2:/);assert.match(workflow,/slither-analyzer==0\.11\.5 crytic-compile==0\.3\.11/);
  assert.match(workflow,/node scripts\/reclaim-v2\/compiler\.mjs/);assert.match(workflow,/forge test --root packages\/contracts\/reclaim-v2/);
  assert.match(workflow,/python docs\/evidence\/rmt-task043\/analyze-rotation\.py/);
  assert.doesNotMatch(workflow,/continue-on-error|--filter-paths|--exclude|--detect|slither-disable/);
  assert.match(workflow,/if: always\(\)/);assert.match(workflow,/reclaim-v2-slither\.json/);
  const compiler=read("scripts/reclaim-v2/compiler.mjs");
  let roots=0;
  for(const directory of["src","interfaces"]){
    const path=new URL(`packages/contracts/reclaim-v2/${directory}/`,root);
    if(existsSync(path))roots+=readdirSync(path,{recursive:true}).filter(file=>file.endsWith(".sol")).length;
  }
  assert.equal(roots,6,"Every permanent V2 production source is a compiler root");
  assert.match(compiler,/\["reclaim-v2\/src", "reclaim-v2\/interfaces"\]/);
  assert.match(compiler,/while \(pending\.length\)/);assert.match(compiler,/Dependency source mismatch/);
});

test("active browser acceptance uses V2 while old V1 is syntax-checked as historical evidence only",()=>{
  const workflow=read(".github/workflows/launch-website-review.yml");
  assert.match(workflow,/name: Syntax-check retained historical V1 browser evidence \(not active acceptance\)\s+run: node --check scripts\/reclaim\/browser-public\.mjs/);
  assert.doesNotMatch(workflow,/^\s+node scripts\/reclaim\/browser-public\.mjs/m);
  assert.match(workflow,/^\s+node scripts\/reclaim-v2\/browser-public\.mjs/m);
  for(const retained of["--profiles-only","--treasury-only --treasury-v2","--reclaim-only","browser: [chromium, webkit]"])assert.ok(workflow.includes(retained));
  assert.match(workflow,/reclaim-safe-acceptance\.json/);assert.match(workflow,/budget-browser\/\*\.png/);
  assert.match(workflow,/timeout-minutes: 30/);
  const repository=read(".github/workflows/ci.yml");
  assert.match(repository,/node --test scripts\/reclaim\/\*\.test\.mjs/);assert.match(repository,/node --test scripts\/reclaim-v2\/\*\.test\.mjs/);
});
