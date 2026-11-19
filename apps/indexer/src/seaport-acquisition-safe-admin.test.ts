import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {keccak256,type Address,type PublicClient} from "viem";
import {readSeaportSafeAdminAccount} from "./seaport-acquisition-safe-admin.js";
import {reclaimCallerPins} from "./reclaim-fixture-origin.js";
const actor="0x0000000000000000000000000000000000018600" as Address;
const fixture=JSON.parse(gunzipSync(readFileSync(new URL("../../launch-website/lib/server/claim-delegate-runtime.test.json.gz",import.meta.url))).toString("utf8")).delegate;
assert.equal(keccak256(fixture.code),reclaimCallerPins.delegateHash);
function provider(actorCode:unknown,...delegateOverride:unknown[]){
 const delegateCode=delegateOverride.length===0?fixture.code:delegateOverride[0];
 const calls:Array<{address:string;tag:string}>=[];const rpc={getChainId:async()=>31337,getCode:async()=>undefined,
  request:async({method,params}:{method:string;params:string[]},options:{retryCount:number})=>{assert.equal(method,"eth_getCode");assert.equal(options.retryCount,0);calls.push({address:params[0]!,tag:params[1]!});return params[0]!.toLowerCase()===reclaimCallerPins.delegate.toLowerCase()?delegateCode:actorCode;}};
 return{rpc:rpc as unknown as PublicClient,calls};
}
test("receipt account roles never treat missing/null/malformed raw code as EOA",async()=>{
 const p=provider("0x"),a=await readSeaportSafeAdminAccount(p.rpc,actor,41n);assert.equal(a.kind,"eoa");assert.equal(a.code,"0x");assert.equal(p.calls[0]!.tag,"0x29");
 for(const code of[undefined,null,"","0x0","0xz0",false])await assert.rejects(readSeaportSafeAdminAccount(provider(code).rpc,actor,41n));
});
test("receipt incoming known7702 has its own exact branch and delegate pre/post pin",async()=>{
 for(const block of[41n,42n]){const p=provider(reclaimCallerPins.designator),a=await readSeaportSafeAdminAccount(p.rpc,actor,block);assert.equal(a.kind,"metamask-7702");assert.equal(p.calls.length,2);}
 for(const code of[undefined,null,"0x","0x6000"])await assert.rejects(readSeaportSafeAdminAccount(provider(reclaimCallerPins.designator,code).rpc,actor,41n));
 await assert.rejects(readSeaportSafeAdminAccount(provider("0xef0100"+"12".repeat(20)).rpc,actor,41n));
});
