import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
import {assertCostRead,executeData,normalizeCostEvidence,remainingWindow} from "./capture-cost.mjs";
const require=createRequire(new URL("../../../../apps/launch-website/package.json",import.meta.url)),v=require("viem");
const expected={tag:"0x1",request:{type:"0x2",chainId:"0x1237",from:"0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA",to:"0xE677A69A8124714DD0d88b73BDf1B89cc791ca9C",value:"0x0",data:executeData,nonce:"0x1"}};
test("Viem uint48 evidence normalizes identically to the canonical notice decimal strings",()=>{
 const abi=v.parseAbi(["function pending() view returns(bytes32,uint48,uint48)"]),values=["0x"+"12".repeat(32),1795131148,1795722606],encoded=v.encodeFunctionResult({abi,functionName:"pending",result:values});
 const decoded=v.decodeFunctionResult({abi,functionName:"pending",data:encoded});assert.equal(typeof decoded[1],"number");assert.deepEqual(normalizeCostEvidence(decoded),[values[0],"1795131148","1795722606"]);assert.deepEqual(normalizeCostEvidence([0n,false]),["0",false]);
});
test("only exact reviewed zero-value Directory execution can be simulated or estimated",()=>{
 assert.doesNotThrow(()=>assertCostRead("eth_estimateGas",[expected.request,expected.tag],expected));assert.doesNotThrow(()=>assertCostRead("eth_call",[expected.request,expected.tag],expected));
 for(const field of["from","to","value","data","nonce","chainId","type"]){const altered=structuredClone(expected);altered.request[field]=field==="nonce"?"0x00":"0xdead";assert.throws(()=>assertCostRead("eth_estimateGas",[altered.request,altered.tag],altered));}
 assert.throws(()=>assertCostRead("eth_estimateGas",[expected.request,"pending"],expected));assert.throws(()=>assertCostRead("eth_call",[expected.request,expected.tag]));
});
test("signing, broadcast, delegation and unrelated RPC methods are rejected",()=>{
 for(const method of["eth_sendTransaction","eth_sendRawTransaction","eth_signTypedData_v4","personal_sign","wallet_sendCalls","anvil_setBalance","debug_traceTransaction"])
  assert.throws(()=>assertCostRead(method,[],expected),/METHOD_OUTSIDE_READ_ONLY_COST_SCOPE/);
 assert.throws(()=>assertCostRead("eth_getBalance",[v.zeroAddress,"0x1"]));assert.throws(()=>assertCostRead("eth_call",[{to:v.zeroAddress,data:"0x"},"0x1"],expected));
});
test("two-day readiness and deadline are inclusive, expiry starts only after the last second",()=>{
 assert.deepEqual(remainingWindow("9","10","20"),{timeEligible:false,expired:false,secondsRemaining:"11",expiryInclusive:true});
 assert.equal(remainingWindow("10","10","20").timeEligible,true);assert.equal(remainingWindow("20","10","20").timeEligible,true);
 assert.deepEqual(remainingWindow("21","10","20"),{timeEligible:false,expired:true,secondsRemaining:"0",expiryInclusive:true});
});
