import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
import {fixtureCallRevert} from "./read-proxy-errors.mjs";
const require=createRequire(new URL("../../apps/indexer/package.json",import.meta.url));
const {encodeErrorResult,parseAbi}=require("viem");
const errorAbi=parseAbi(["error Error(string reason)"]);
const data=encodeErrorResult({abi:errorAbi,errorName:"Error",args:["NONEXISTENT"]});
const body=()=>({jsonrpc:"2.0",id:1,error:{code:3,message:"execution reverted: NONEXISTENT",data}});
test("the local proxy preserves genuine canonical Error(string) revert bytes without forwarding arbitrary details",()=>{
  const original=body(),copy=structuredClone(original),out=fixtureCallRevert("eth_call",original);
  assert.deepEqual(out,{code:3,message:"execution reverted",data});assert.deepEqual(original,copy);
  assert.equal(fixtureCallRevert("eth_call",{...body(),error:{...body().error,code:-32603}}).code,-32603);
});
test("missing, malformed, unrelated and unavailable RPC evidence never becomes an ownership-absence proof",()=>{
  const negatives=[null,{}, {...body(),id:2},{...body(),jsonrpc:"1.0"},{...body(),result:"0x"},
    {...body(),error:{...body().error,code:-32000}},{...body(),error:{...body().error,message:"Fixture RPC is offline"}},
    {...body(),error:{...body().error,data:"0x"}}, {...body(),error:{...body().error,data:data+"00"}},
    {...body(),error:{...body().error,data:"0x4e487b71"+"00".repeat(32)}},
    {...body(),error:{...body().error,message:"execution reverted: "+"x".repeat(513)}},
    {...body(),error:{...body().error,data:encodeErrorResult({abi:errorAbi,errorName:"Error",args:["x".repeat(257)]})}}];
  for(const value of negatives)assert.equal(fixtureCallRevert("eth_call",value),null);
  for(const method of["eth_getCode","eth_getTransactionReceipt","eth_sendTransaction"])assert.equal(fixtureCallRevert(method,body()),null);
});
