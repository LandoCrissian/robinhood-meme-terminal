import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import test from "node:test";
import {observeReclaim4663} from "./read-only-4663.mjs";

const report=JSON.parse(readFileSync(new URL("../../docs/evidence/rmt-task078/read-only-4663.json",import.meta.url),"utf8"));
test("dated 4663 observations bind both providers to one unchanged block and every existing Safe runtime",()=>{
  assert.equal(report.signing,false);assert.equal(report.broadcast,false);assert.equal(report.productionChanges,false);assert.equal(report.reclaimActivation,false);
  assert.equal(report.configurationStatus,"BOTH_EXISTING_SAFES_APPROVED_CONFIGURATION_CORROBORATED");assert.equal(report.corroboration.status,"CORROBORATED");
  const archive=JSON.parse(readFileSync(new URL("../../packages/contracts/test/fixtures/safe-1.4.1/runtime.json",import.meta.url),"utf8"));
  for(const[name,p]of Object.entries(report.providers)){
    assert.ok(["official","pocket"].includes(name));assert.equal(p.chain.value,4663);assert.equal(p.status,"ANCHORED_L2_OBSERVATION");
    assert.equal(p.anchor.value.number,report.anchor.number);assert.equal(p.anchor.value.hash,p.recheckedAnchor.value.hash);assert.equal(p.anchor.value.hash,report.corroboration.value.anchor.hash);
    for(const[role,pin]of Object.entries(archive.contracts)){assert.equal(p.runtimes[role].status,"observed");assert.equal(p.runtimes[role].value.runtimeHash,pin.runtimeKeccak256);assert.equal(p.runtimes[role].value.matches,true);}
    for(const s of Object.values(p.safes)){assert.equal(s.approvedConfigurationObserved,true);assert.equal(s.views.VERSION.value,"1.4.1");assert.equal(s.views.getThreshold.value,"2");
      assert.deepEqual(new Set(s.views.getOwners.value.map(a=>a.toLowerCase())),new Set(report.expectedOwners));assert.equal(s.views.erc721Receiver.value,true);assert.equal(s.views.erc1155Receiver.value,true);}
    assert.ok(Object.values(p.governanceOwnerCode).every(c=>c.status==="observed"&&c.value.empty));
  }
  for(const source of report.sourceBindings){const text=readFileSync(new URL("../../"+source.path,import.meta.url),"utf8").replaceAll("\r\n","\n");assert.equal(createHash("sha256").update(text).digest("hex"),source.sha256,source.path);}
});
test("unavailable providers remain unknown and the bounded probe never requests signing or writes",async()=>{
  const calls=[];const result=await observeReclaim4663({fetcher:async(url,request)=>{const body=JSON.parse(request.body);calls.push({url,method:body.method,params:body.params});return new Response(null,{status:503});}});
  assert.equal(result.anchor,null);assert.equal(result.corroboration.status,"UNVERIFIED");assert.equal(result.reclaimActivation,false);
  assert.ok(calls.length<=8&&calls.length>0);assert.ok(calls.every(c=>["eth_chainId","eth_getBlockByNumber"].includes(c.method)));
  assert.ok(Object.values(result.providers).every(p=>p.chain.status==="unavailable"&&p.head.status==="unavailable"));
});
