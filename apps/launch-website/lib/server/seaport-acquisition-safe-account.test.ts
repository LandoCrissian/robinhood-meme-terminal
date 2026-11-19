import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {keccak256,type Address,type PublicClient} from "viem";
import {readSeaportSafeAccount} from "./seaport-acquisition-safe-account";
import {claimDelegatePin} from "../claim-profiles";
const actor="0x0000000000000000000000000000000000018600" as Address;
const fixture=JSON.parse(gunzipSync(readFileSync(new URL("./claim-delegate-runtime.test.json.gz",import.meta.url))).toString("utf8")).delegate;
assert.equal(keccak256(fixture.code),claimDelegatePin.runtimeHash);
function provider(actorCode:unknown,delegateCode:unknown=fixture.code){
 const calls:Array<{address:string;tag:string}>=[];const rpc={getChainId:async()=>31337,getCode:async()=>undefined,
  request:async({method,params}:{method:string;params:string[]},options:{retryCount:number})=>{assert.equal(method,"eth_getCode");assert.equal(options.retryCount,0);calls.push({address:params[0]!,tag:params[1]!});return params[0]!.toLowerCase()===claimDelegatePin.address.toLowerCase()?delegateCode:actorCode;}};
 return{rpc:rpc as unknown as PublicClient,calls};
}
test("Safe role corroboration admits only actual raw empty code for EOA, including pending",async()=>{
 for(const block of[41n,"pending"]as const){const p=provider("0x"),a=await readSeaportSafeAccount(p.rpc,actor,block);assert.equal(a.kind,"eoa");assert.equal(a.code,"0x");assert.equal(p.calls[0]!.tag,block==="pending"?"pending":"0x29");}
 for(const code of[undefined,null,"","0x0","0xz0",false])await assert.rejects(readSeaportSafeAccount(provider(code).rpc,actor,41n));
});
test("incoming known7702 is separate from Safe and requires the exact preserved delegate runtime",async()=>{
 const p=provider(claimDelegatePin.designator),a=await readSeaportSafeAccount(p.rpc,actor,41n);assert.equal(a.kind,"metamask-7702");assert.equal(a.code,claimDelegatePin.designator);assert.equal(p.calls.length,2);
 for(const code of[undefined,null,"0x","0x6000"])await assert.rejects(readSeaportSafeAccount(provider(claimDelegatePin.designator,code).rpc,actor,41n));
 await assert.rejects(readSeaportSafeAccount(provider("0xef0100"+"12".repeat(20)).rpc,actor,41n));
});
