import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
import {readSeaportRawAccountCode,seaportRawAccountCodeLimits} from "./seaport-vault-account-code.mjs";
const require=createRequire(new URL("../../apps/launch-website/package.json",import.meta.url)),v=require("viem");
const address="0x0000000000000000000000000000000000012345";
test("raw account evidence binds an explicit block or pending without retries",async()=>{
 const calls=[],rpc={request:async(args,options)=>{calls.push({args,options});return calls.length===1?"0x":"0xAB12";}};
 assert.equal(await readSeaportRawAccountCode(rpc,address,31n),"0x");
 assert.equal(await readSeaportRawAccountCode(rpc,address,"pending"),"0xAB12");
 assert.deepEqual(calls.map(c=>c.args),[{method:"eth_getCode",params:[address,"0x1f"]},{method:"eth_getCode",params:[address,"pending"]}]);
 for(const call of calls){assert.equal(call.options.retryCount,0);assert.ok(call.options.signal instanceof AbortSignal);assert.equal(call.options.signal.aborted,true);}
});
test("missing null malformed and oversized code are unavailable rather than empty code",async()=>{
 const invalid=[undefined,null,false,0,{},[],"","0X","0x0","0xxyz","0x00zz","0x"+"ab".repeat(seaportRawAccountCodeLimits.maxBytes+1)];
 for(const raw of invalid){let calls=0;await assert.rejects(readSeaportRawAccountCode({request:async()=>{calls++;return raw;}},address,0n),/unavailable/);assert.equal(calls,1);}
 assert.equal(await readSeaportRawAccountCode({request:async()=>"0x"+"ab".repeat(seaportRawAccountCodeLimits.maxBytes)},address,0n),"0x"+"ab".repeat(seaportRawAccountCodeLimits.maxBytes));
 const failure=Error("provider unavailable");await assert.rejects(readSeaportRawAccountCode({request:async()=>{throw failure;}},address,0n),e=>e===failure);
});
test("genuine Viem HTTP decoding cannot turn a malformed success envelope into EOA proof",async()=>{
 for(const kind of["empty","missing","null"]){
  const envelope={jsonrpc:"2.0",id:1,...(kind==="missing"?{}:{result:kind==="empty"?"0x":null})};
  let calls=0;const rpc=v.createPublicClient({transport:v.http("http://127.0.0.1:1",{retryCount:0,fetchFn:async()=>{calls++;return new Response(JSON.stringify(envelope),{status:200,headers:{"content-type":"application/json"}});}})});
  const decoded=await rpc.getCode({address,blockNumber:1n});assert.ok(decoded===undefined||decoded===null);
  if(kind==="empty")assert.equal(await readSeaportRawAccountCode(rpc,address,1n),"0x");
  else await assert.rejects(readSeaportRawAccountCode(rpc,address,1n),/unavailable/);
  assert.equal(calls,2);
 }
});
test("a nonresponsive provider is aborted at the fixed five-second boundary",async t=>{
 t.mock.timers.enable({apis:["setTimeout"]});let observed,calls=0;
 try{
  const pending=readSeaportRawAccountCode({request:(_args,options)=>{calls++;observed=options.signal;return new Promise(()=>{});}},address,1n);
  const checked=assert.rejects(pending,/timeout/);t.mock.timers.tick(5000);await checked;
  assert.equal(calls,1);assert.equal(observed.aborted,true);
 }finally{t.mock.timers.reset();}
});
test("invalid identity or implicit block selection makes no provider request",async()=>{
 let calls=0;const rpc={request:async()=>{calls++;return"0x";}};
 for(const value of[undefined,"latest","0x1",1,-1n,2n**256n])await assert.rejects(readSeaportRawAccountCode(rpc,address,value),/unavailable/);
 for(const value of[undefined,"","0x1234","0x"+"0".repeat(40)])await assert.rejects(readSeaportRawAccountCode(rpc,value,1n),/unavailable/);
 await assert.rejects(readSeaportRawAccountCode({},address,1n),/unavailable/);assert.equal(calls,0);
});
