import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {assertArchiveIntegrity} from "../rmt-task083/security/verify-artifacts.mjs";

const root=fileURLToPath(new URL("../../../",import.meta.url));
const git=(...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8",windowsHide:true});
const production="2641f11b4718250038aab3e93870d3151ae1054c";

test("today's package, contract and security changes are bounded against the actual deployed website source",()=>{
 const protectedPath=p=>/(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|package-lock\.json|yarn\.lock)$/.test(p)
  || p.startsWith("packages/contracts/") || p.startsWith("scripts/release/") || p.startsWith("scripts/security/")
  || p.startsWith(".github/") || p.startsWith(".gitleaks") || p.startsWith("docs/evidence/fixed-supply-security/")
  || /^docs\/evidence\/rmt-task08[0-3]\/(history|security)\//.test(p) || p==="docs/evidence/rmt-task043/analyze-rotation.py";
 // Pin reviewed edits to existing files. New classifiers and their tests are
 // covered independently by their positive proof and fresh rejection canary.
 const changes=new Map([
  [".github/workflows/ci.yml","2a66d1b6dc06bd9cffc5a513688d47830424b313"],
  ["apps/indexer/package.json","8e32f308bd907572ebb7694cf7830f0426cbc4e0"],
  ["apps/launch-website/package.json","5734abd6d548eaca1a07bdcc6a2b2cf637089e77"],
  ["pnpm-lock.yaml","de395bc9e33ce18f1ab8293c9b629980e360b7a2"],
  [".github/workflows/launch-website-review.yml","af59b869053f94fa4c5a6a18bcb066871cf68ba0"],
  [".github/workflows/task092-production-adapters.yml","08b5ce14e0dfb95975858ba64e8d5fa92eb23303"],
  [".github/workflows/core-launch-go-no-go.yml","fc24874ee69e92ac81d096a74aa478b7465d4685"],
  [".github/scripts/run-task092-postgres.sh","c86d66b2301801d1b34b8aa20206e0fde7d7cc4c"],
  ["scripts/security/run-history-scan.mjs","71f23518ad23aefd7f05d6977aa6f52e3ebef88b"],
  ["scripts/security/public-task092-identities.test.mjs","7555a91e55f63e2c794aa956e881c3dfa412abbe"],
 ]);
 const additions=["scripts/security/public-market-identities.mjs","scripts/security/public-market-identities.test.mjs"];

 const diff=git("diff","--no-renames","--name-only","-z",production).split("\0").filter(protectedPath).sort();
 assert.deepEqual(diff,[...changes.keys(),...additions,"package.json"].sort());
 for(const [path,blob] of changes) assert.equal(git("hash-object","--path",path,path).trim(),blob,path);
 const rootManifest=JSON.parse(git("show",production+":package.json"));
 rootManifest.scripts["test:release-evidence"]="node scripts/release-evidence-tests.mjs";
 assert.deepEqual(JSON.parse(readFileSync(join(root,"package.json"))),rootManifest);
 const archiveRoot=join(root,"docs/evidence/rmt-task083/security");
 const archive=JSON.parse(readFileSync(join(archiveRoot,"integrity.json")));
 assertArchiveIntegrity(new Map(archive.files.map(file=>[file.path,readFileSync(join(archiveRoot,file.path))])),archive);
 const path="apps/launch-website/package.json", expected=JSON.parse(git("show",production+":"+path));
 expected.dependencies["lightweight-charts"]="5.3.0";
 assert.deepEqual(JSON.parse(readFileSync(join(root,path))),expected);
 const workerPath="apps/indexer/package.json", worker=JSON.parse(git("show",production+":"+workerPath));
 Object.assign(worker.scripts,{"test:backfill-http":"tsx src/backfill-http-smoke.ts","test:activity-backlog":"tsx src/activity-backlog-smoke.ts","test:provider-budget":"tsx --test src/feed-scheduler.test.ts"});
 assert.deepEqual(JSON.parse(readFileSync(join(root,workerPath))),worker);
});
