import test from "node:test";
import assert from "node:assert/strict";
import {assertSeaportVaultTrace} from "./seaport-vault-proof.mjs";
const a=n=>"0x"+n.toString(16).padStart(40,"0"),origin={from:a(1),to:a(2),input:"0x01020304",value:0n};
const expected={vault:a(2),seaport:a(3),collection:a(4),purchaseInput:origin.input,fulfillInput:"0x05060708",nftTransferInput:"0x090a0b0c",total:100n,native:true,payments:[{recipient:a(5),amount:90n},{recipient:a(6),amount:10n}]};
const call=(from,to,input,value="0x0",calls=[])=>({type:"CALL",from,to,input,value,output:"0x",calls});
function trace(){return call(a(1),a(2),origin.input,"0x0",[call(a(2),a(3),expected.fulfillInput,"0x64",[call(a(3),a(4),expected.nftTransferInput),call(a(3),a(5),"0x","0x5a"),call(a(3),a(6),"0x","0xa")])]);}
test("V2 native proof binds exact transaction, fulfillment, custody and every consideration recipient",()=>{
  assert.equal(assertSeaportVaultTrace(trace(),origin,expected).nativeTransfers,3);
  const mutations=[t=>t.from=a(9),t=>t.calls[0].input="0x",t=>t.calls[0].calls[0].to=a(9),t=>t.calls[0].calls[1].value="0x59",t=>t.calls[0].calls.push(call(a(3),a(9),"0x","0x1")),t=>t.calls[0].error="reverted",t=>t.calls[0].calls.pop(),t=>t.calls[0].calls[0].type="DELEGATECALL"];
  for(const mutate of mutations){const t=trace();mutate(t);assert.throws(()=>assertSeaportVaultTrace(t,origin,expected),/proof unavailable/);}
  assert.throws(()=>assertSeaportVaultTrace(null,origin,expected));
});
test("V2 token proof requires per-recipient exact transferFrom calls, no native payments",()=>{
  const e={...expected,native:false,currency:a(7),tokenTransferInputs:["0x11111111","0x22222222"]},t=trace();t.calls[0].value="0x0";t.calls[0].calls.splice(1,2,...e.tokenTransferInputs.map(input=>({...call(a(3),a(7),input),output:"0x"+"0".repeat(63)+"1"})));
  assert.equal(assertSeaportVaultTrace(t,origin,e).nativeTransfers,0);
  t.calls[0].calls[1].input="0x33333333";assert.throws(()=>assertSeaportVaultTrace(t,origin,e));
});
