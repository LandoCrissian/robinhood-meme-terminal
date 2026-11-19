import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNftAcquisitionTrace } from "../../packages/launchpad-common/nft-acquisition-proof.mjs";

const a = n => "0x" + n.toString(16).padStart(40,"0");
const call = (from,to,input,value="0x0",calls=[]) => ({type:"CALL",from,to,input,value,calls});
const origin={from:a(100),to:a(101),input:"0x12345678",value:0n};
const expected={vault:a(101),venue:a(102),collection:a(103),purchaseInput:origin.input,fillInput:"0x87654321",nftTransferInput:"0xaabbccdd",totalCost:100n,native:true,
  payments:[{recipient:a(104),amount:90n},{recipient:a(105),amount:5n},{recipient:a(106),amount:5n}]};
const valid=()=>call(origin.from,origin.to,origin.input,"0x0",[call(a(101),a(102),expected.fillInput,"0x64",[
  call(a(102),a(103),expected.nftTransferInput),call(a(102),a(104),"0x","0x5a"),call(a(102),a(105),"0x","0x5"),call(a(102),a(106),"0x","0x5")])]);
test("exact per-transaction native proof does not rely on the number of other transactions in a block",()=>{
  assert.equal(assertNftAcquisitionTrace(valid(),origin,expected).nativeTransfers,4);
  assert.equal(assertNftAcquisitionTrace(valid(),origin,expected).nativeTransfers,4);
});
for (const [name,mutate] of [
  ["missing",()=>undefined], ["wrong-origin",x=>({...x,from:a(999)})], ["reverted",x=>({...x,error:"revert"})],
  ["redirected-seller",x=>{x.calls[0].calls[1].to=a(999);return x;}],
  ["extra-native",x=>{x.calls[0].calls.push(call(a(102),a(999),"0x","0x1"));return x;}],
  ["short-native",x=>{x.calls[0].calls[1].value="0x59";return x;}],
  ["wrong-nft",x=>{x.calls[0].calls[0].input="0xeeeeeeee";return x;}],
  ["duplicate-nft",x=>{x.calls[0].calls.push(call(a(102),a(103),expected.nftTransferInput));return x;}],
  ["bad-child-origin",x=>{x.calls[0].calls[0].from=a(999);return x;}],
  ["unexpected-delegatecall",x=>{x.calls[0].calls.push({type:"DELEGATECALL",from:a(102),to:a(999),input:"0x"});return x;}],
]) test("trace rejects "+name,()=>assert.throws(()=>assertNftAcquisitionTrace(mutate(valid()),origin,expected),/unavailable or conflicting/));
test("ERC20 mode never treats an NFT order as a native payment proof",()=>{
  assert.throws(()=>assertNftAcquisitionTrace(valid(),origin,{...expected,native:false}),/unavailable or conflicting/);
});
