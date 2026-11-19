import assert from "node:assert/strict";
import {existsSync,readFileSync,statSync} from "node:fs";
import {dirname,extname,relative,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";
import {reclaimCampaignSignatures,reclaimFactorySignatures} from "../../packages/launchpad-common/reclaim-v2-runtime.mjs";

const root=fileURLToPath(new URL("../../",import.meta.url));
const text=file=>readFileSync(resolve(root,file),"utf8");
const portable=file=>relative(root,file).split(sep).join("/");
const historical=file=>file==="packages/launchpad-common/reclaim-runtime.mjs"
  ||file.startsWith("scripts/reclaim/")||file.startsWith("packages/contracts/reclaim/");
function resolveLocal(parent,specifier){
  const base=resolve(dirname(parent),specifier);
  const candidates=[base,...[".ts",".tsx",".mjs",".mts",".js"].map(s=>base+s),resolve(base,"index.ts")];
  if(base.endsWith(".js"))candidates.push(base.slice(0,-3)+".ts",base.slice(0,-3)+".tsx");
  const file=candidates.find(file=>existsSync(file)&&statSync(file).isFile());
  assert.ok(file,`${portable(parent)}: missing local module ${specifier}`);
  assert.ok(!relative(root,file).startsWith(".."),"Local import must remain in the repository");
  return file;
}
function importClosure(entries){
  const visited=new Set(),pending=entries.map(file=>resolve(root,file));
  while(pending.length){
    const file=pending.pop();if(visited.has(file))continue;
    const name=portable(file);assert.ok(!historical(name),`Historical reversible Reclaim is reachable: ${name}`);visited.add(file);
    if(![".ts",".tsx",".mjs",".mts",".js"].includes(extname(file)))continue;
    const source=readFileSync(file,"utf8");
    for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"']+)["']/g)){
      if(match[1].startsWith("."))pending.push(resolveLocal(file,match[1]));
    }
  }
  return new Set([...visited].map(portable));
}

test("active browser, server, indexer and integration graphs cannot import reversible Reclaim helpers",()=>{
  const graph=importClosure([
    "apps/launch-website/lib/reclaim.ts","apps/launch-website/lib/reclaim-safe.ts",
    "apps/launch-website/lib/server/reclaim-actions.ts","apps/launch-website/lib/server/reclaim-safe-actions.ts",
    "apps/launch-website/app/api/launchpad/reclaim/route.ts","apps/launch-website/app/api/launchpad/test-reclaim/route.ts",
    "apps/indexer/src/curve-fixture-worker.ts",
    "scripts/visual-qa/rmt-creator-integration.mjs","scripts/reclaim-v2/browser-integration.mjs","scripts/reclaim-v2/browser-public.mjs",
  ]);
  for(const required of ["packages/launchpad-common/reclaim-v2-runtime.mjs","apps/indexer/src/reclaim-fixture-evidence.ts",
    "apps/launch-website/lib/server/reclaim-fixture.ts","scripts/reclaim-v2/compiler.mjs","scripts/reclaim-v2/deploy-fixture.mjs",
    "scripts/reclaim-v2/fixture-assets.mjs","scripts/reclaim-v2/local-integration.mjs"])assert.ok(graph.has(required),`Active graph must include ${required}`);
  assert.ok(graph.size>20,"Check complete local import closure, not just direct imports");
  assert.ok(existsSync(resolve(root,"packages/launchpad-common/reclaim-runtime.mjs")),"Rejected V1 helper remains historical evidence");
  assert.ok(existsSync(resolve(root,"packages/contracts/reclaim/src/RMTReclaimCampaignV1.sol")),"Rejected V1 source remains historical evidence");
});

test("the active typed ABI has permanent retirement and no NFT return or repayment entrypoint",()=>{
  const names=[...reclaimCampaignSignatures,...reclaimFactorySignatures].map(line=>/^\s*(?:function|event)\s+(\w+)\b/.exec(line)?.[1]).filter(Boolean);
  for(const forbidden of ["returnTradeIn","repay","repayTradeIn","TradeInReturned","approveReturn","requestReturn","withdrawNFT","rescueNFT"])
    assert.ok(!names.includes(forbidden),`Forbidden reversible ABI entry ${forbidden}`);
  assert.ok(names.includes("redeem")&&names.includes("NFTPermanentlyRetired")&&names.includes("TradeInAccepted"));
  assert.match(reclaimCampaignSignatures.find(line=>line.startsWith("event NFTPermanentlyRetired")),/retirementMode.*destination.*supplyBefore.*supplyAfter/);
  assert.match(text("apps/indexer/src/reclaim-fixture-evidence.ts"),/requireReclaimEvidence\(parsed\.length===1\)/,"Unknown or legacy receipt events must not be silently accepted");
  const regression=text("apps/indexer/src/reclaim-fixture-evidence-smoke.ts");
  assert.match(regression,/knobs\.mode==="legacy-return"/);
  assert.match(regression,/"legacy-return"/);
});

test("both transaction preparation paths and receipt intake remain synthetic-chain bound",()=>{
  const fixture=text("apps/launch-website/lib/server/reclaim-fixture.ts"),direct=text("apps/launch-website/lib/server/reclaim-actions.ts"),safe=text("apps/launch-website/lib/server/reclaim-safe-actions.ts");
  assert.match(fixture,/m\.chainId!==31337/);assert.match(fixture,/chain===31337n/);assert.match(fixture,/process\.env\.RMT_RECLAIM_FIXTURE!==reclaimFixtureFlag/);
  assert.match(direct,/configuredReclaimFixture\(request\.headers\)/);assert.match(direct,/verifyReclaimContext\(config\)/);
  assert.match(direct,/chainId:"0x7a69"/);assert.match(direct,/tx\.chainId===31337/);
  assert.match(safe,/verifyReclaimContext\(config\)/);assert.match(safe,/chainId:"0x7a69"/);assert.match(safe,/verifyReclaimTransaction\(config,p\.innerReview/);
  assert.match(direct,/url\.protocol!=="http:"/);assert.match(direct,/request\.headers\.get\("origin"\)!==config\.curve\.origin/);
  for(const source of [direct,safe]){
    assert.ok(source.includes("executionEnabled:false"));
    assert.doesNotMatch(source,/eth_sendRawTransaction|writeContract\s*\(|sendTransaction\s*\(/,"Server preparation/recovery never broadcasts");
  }
  const evidence=text("apps/indexer/src/reclaim-fixture-evidence.ts"),origin=text("apps/indexer/src/reclaim-fixture-origin.ts");
  assert.match(evidence,/m\.chainId===31337/);assert.match(evidence,/await rpc\.getChainId\(\)===31337/);
  assert.match(origin,/tx\.chainId===31337/);assert.match(origin,/await rpc\.getChainId\(\)===31337/);
});

test("the V2 compiler admission roots remain independently versioned and complete",()=>{
  const compiler=text("scripts/reclaim-v2/compiler.mjs");
  assert.match(compiler,/\["reclaim-v2\/src", "reclaim-v2\/interfaces"\]/);
  assert.match(compiler,/for \(const match of imports\) pending\.push\(resolveImport\(file, match\[1\]\)\)/,"All reachable Solidity dependencies must be included");
  assert.doesNotMatch(compiler,/slither-disable|exclude-high|exclude-dependencies|filter-paths|skip-assembly/);
});
