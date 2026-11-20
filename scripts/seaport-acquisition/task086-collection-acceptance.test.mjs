// Mocked transport checks only. Genuine Seaport and the real collection reads
// execute separately in the existing four connected browser/fork jobs.
import assert from "node:assert/strict";
import test from "node:test";
import {captureCollectionEthCall} from "./task086-collection-acceptance.mjs";
const base={url:"http://127.0.0.1:12345",from:"0x0000000000000000000000000000000000010001",to:"0x0000000000000000000000000000000000010002",data:"0x23b872dd",blockTag:"0x123"};
const response=body=>new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json"}});
test("read-only local eth_call retains exact authorization revert separately from validator policy",async()=>{
 let requests=0;const result=await captureCollectionEthCall({...base,fetchImpl:async(url,options)=>{requests++;assert.equal(url,base.url);assert.equal(options.method,"POST");assert.equal(options.redirect,"error");const payload=JSON.parse(options.body);assert.equal(payload.method,"eth_call");assert.equal(payload.params[0].from,base.from);assert.equal(payload.params[0].value,"0x0");assert.equal(payload.params[1],"0x123");return response({jsonrpc:"2.0",id:86,error:{code:3,message:"synthetic authorization revert",data:"0x59c896be"}});}});
 assert.equal(result.status,"REVERTED_OR_UNAVAILABLE");assert.equal(result.revertData,"0x59c896be");assert.equal(result.selector,"0x59c896be");assert.equal(result.broadcast,false);assert.equal(requests,1);assert.match(result.rawSha256,/^[a-f0-9]{64}$/);
});
test("missing and malformed results never become successful empty-return proof",async()=>{
 for(const data of[{jsonrpc:"2.0",id:86},{jsonrpc:"2.0",id:86,result:null},{jsonrpc:"2.0",id:86,result:"not-hex"},{jsonrpc:"2.0",id:87,result:"0x"}])await assert.rejects(captureCollectionEthCall({...base,fetchImpl:async()=>response(data)}));
 const returned=await captureCollectionEthCall({...base,fetchImpl:async()=>response({jsonrpc:"2.0",id:86,result:"0x"})});assert.equal(returned.status,"RETURNED");assert.equal(returned.result,"0x");
 const unknown=await captureCollectionEthCall({...base,fetchImpl:async()=>response({jsonrpc:"2.0",id:86,error:{code:-32000,message:"synthetic unavailable"}})});assert.equal(unknown.status,"REVERTED_OR_UNAVAILABLE");assert.equal(unknown.selector,null);
});
test("fixed loopback context and numbered block reject public, credentialed and implicit targets before a request",async()=>{
 let reads=0;for(const changes of[{url:"https://rpc.mainnet.chain.robinhood.com"},{url:"http://user:secret@127.0.0.1:12345"},{url:"http://127.0.0.1:12345/private"},{url:"http://127.0.0.1:12345?rpc=elsewhere"},{blockTag:"latest"},{data:"0x1"},{from:"invalid"}])await assert.rejects(captureCollectionEthCall({...base,...changes,fetchImpl:async()=>{reads++;return response({});}}));assert.equal(reads,0);
});
test("bounded response and strict UTF8 cannot conceal a provider failure",async()=>{
 await assert.rejects(captureCollectionEthCall({...base,fetchImpl:async()=>new Response("a".repeat(65537),{status:200})}),/LOCAL_CALL_RESPONSE_BOUND/);
 await assert.rejects(captureCollectionEthCall({...base,fetchImpl:async()=>new Response(Uint8Array.from([0xc3,0x28]),{status:200})}));
 await assert.rejects(captureCollectionEthCall({...base,fetchImpl:async()=>new Response("",{status:503})}));
});
