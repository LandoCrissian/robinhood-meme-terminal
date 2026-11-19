import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
import {seaportSafePins,seaportSafeTypedData,verifySeaportSafeApprovals,validSeaportSafeTx,compileSeaportSafeCall,decodeSeaportSafeCall,assertSeaportSafeAdminTrace,assertSeaportSafeAdminRevertTrace,readSeaportSafeState} from "./seaport-vault-safe.mjs";
const require=createRequire(new URL("../../apps/indexer/package.json",import.meta.url)),v=require("viem"),{privateKeyToAccount}=require("viem/accounts");
const owners=[1,2,3].map(x=>privateKeyToAccount("0x"+String(x).padStart(64,"0"))),a=x=>v.getAddress("0x"+x.toString(16).padStart(40,"0")),safe=a(100001),payer=a(100002),vault=a(100003),payment=a(100004),collection=a(100005),hash="0x"+"12".repeat(32),pins={vault,vaultRuntimeHash:hash,paymentToken:payment,paymentTokenRuntimeHash:hash,fee:a(100006),collections:[{address:collection,standard:721,runtimeHash:hash}]};
const call=compileSeaportSafeCall(pins,"disable",{},v),safeTx={to:vault,value:"0",data:call.data,operation:0,safeTxGas:"0",baseGas:"0",gasPrice:"0",gasToken:v.zeroAddress,refundReceiver:v.zeroAddress,nonce:"7"};
const sign=async(tx=safeTx)=>Promise.all(owners.slice(0,2).map(async o=>({signer:o.address,signature:await o.signTypedData(seaportSafeTypedData(safe,tx))}))).then(a=>a.sort((a,b)=>BigInt(a.signer)<BigInt(b.signer)?-1:1));
test("two genuine EIP712 owners bind the chain, Safe, nonce and exact CALL",async()=>{
 const approvals=await sign();assert.equal(await verifySeaportSafeApprovals(safe,safeTx,owners.map(o=>o.address),approvals,v),true);
 for(const changed of[{...safeTx,nonce:"8"},{...safeTx,to:payment},{...safeTx,value:"1"}])assert.equal(await verifySeaportSafeApprovals(safe,changed,owners.map(o=>o.address),approvals,v),false);
 assert.equal(await verifySeaportSafeApprovals(a(100099),safeTx,owners.map(o=>o.address),approvals,v),false);
 assert.equal(await verifySeaportSafeApprovals(safe,safeTx,owners.map(o=>o.address),approvals.slice(0,1),v),false);
 assert.equal(await verifySeaportSafeApprovals(safe,safeTx,owners.map(o=>o.address),[approvals[0],approvals[0]],v),false);
 assert.equal(await verifySeaportSafeApprovals(safe,safeTx,owners.map(o=>o.address),[...approvals].reverse(),v),false);
});
test("Safe gas/refund fields and DELEGATECALL are outside the admitted profile",()=>{
 assert.equal(validSeaportSafeTx(safeTx),true);for(const patch of[{operation:1},{safeTxGas:"1"},{baseGas:"1"},{gasPrice:"1"},{gasToken:payment},{refundReceiver:payer},{arbitrary:"field"}])assert.equal(validSeaportSafeTx({...safeTx,...patch}),false);
});
test("bounded call compiler and decoder preserve exact target, selector, fields and native value",()=>{
 const source=hash,cases=[["configure",{currency:v.zeroAddress,perNftCap:"1",totalBudget:"9",periodBudget:"5",cooldownSeconds:"1",enabled:true}],["disable",{}],["configure-collection",{collection,enabled:true,anyTokenId:false,ids:"1,2"}],["configure-fee-recipient",{recipient:pins.fee,maxBps:"500"}],["fund-native",{amountWei:"1",source}],["approve-funding",{amountWei:"1"}],["fund-token",{amountWei:"1",source}],["propose-controller",{incoming:payer,expiresAt:"999999"}],["cancel-controller",{}],["accept-controller",{}]];
 for(const[op,fields]of cases){const c=compileSeaportSafeCall(pins,op,fields,v),decoded=decodeSeaportSafeCall(pins,c.to,c.data,BigInt(c.value),v);assert.equal(decoded.operation,op);assert.deepEqual(decoded.fields,fields);assert.deepEqual(decoded.call,c);assert.throws(()=>decodeSeaportSafeCall(pins,c.to,c.data+"00",BigInt(c.value),v));}
 assert.throws(()=>compileSeaportSafeCall(pins,"create",{},v));assert.throws(()=>compileSeaportSafeCall(pins,"disable",{data:"0x"},v));assert.throws(()=>compileSeaportSafeCall(pins,"configure-fee-recipient",{recipient:payer,maxBps:"1"},v));
 assert.throws(()=>compileSeaportSafeCall(pins,"configure-collection",{collection,enabled:true,anyTokenId:false,ids:"2,1"},v));
});
const origin={from:payer,to:safe,input:"0x12345678",value:0n},inner={safe,target:vault,data:call.data,value:0n};
const trace=()=>({type:"CALL",from:payer,to:safe,input:origin.input,value:"0x0",calls:[{type:"DELEGATECALL",from:safe,to:seaportSafePins.singleton,input:origin.input,value:"0x0",calls:[{type:"CALL",from:safe,to:vault,input:call.data,value:"0x0"}]}]});
test("Safe trace admits one exact mutable CALL and binds the full outer identity",()=>{
 assert.equal(assertSeaportSafeAdminTrace(trace(),origin,inner).frames,3);
 assert.throws(()=>assertSeaportSafeAdminTrace(trace(),{...origin,to:payer},inner));
 for(const target of[vault,payment]){const t=trace();t.calls[0].calls.push({type:"CALL",from:safe,to:target,input:"0x095ea7b3",value:"0x0"});assert.throws(()=>assertSeaportSafeAdminTrace(t,origin,inner));}
 const unknown=trace();unknown.calls[0].to=payment;assert.throws(()=>assertSeaportSafeAdminTrace(unknown,origin,inner));
});
test("GS013 trace requires actual outer and inner errors, and success trace rejects errors",()=>{
 const t=trace();t.error="execution reverted";t.calls[0].error="execution reverted";t.calls[0].calls[0].error="execution reverted";
 assert.equal(assertSeaportSafeAdminRevertTrace(t,origin,inner).nativeTransfers,0);assert.throws(()=>assertSeaportSafeAdminTrace(t,origin,inner));assert.throws(()=>assertSeaportSafeAdminRevertTrace(trace(),origin,inner));
});
test("Safe state rejects unknown runtime, owner delegation, threshold, modules, guard or handler",async()=>{
 const code="0x1234",ownerAddresses=owners.map(o=>o.address),state={VERSION:"1.4.1",masterCopy:seaportSafePins.singleton,getOwners:ownerAddresses,getThreshold:2n,nonce:7n,getModulesPaginated:[[],"0x0000000000000000000000000000000000000001"]},codec={...v,keccak256:x=>x===code?seaportSafePins.proxyHash:x==="0x5678"?seaportSafePins.singletonHash:seaportSafePins.handlerHash};
 const rpc={getChainId:async()=>31337,getCode:async({address})=>address===safe?code:address===seaportSafePins.singleton?"0x5678":address===seaportSafePins.handler?"0xabcd":undefined,request:async({method,params})=>{assert.equal(method,"eth_getCode");assert.ok(ownerAddresses.includes(params[0]));assert.ok(["0x1","pending"].includes(params[1]));return"0x";},readContract:async({functionName})=>state[functionName],getStorageAt:async({slot})=>slot===seaportSafePins.guardSlot?v.zeroHash:"0x"+"0".repeat(24)+seaportSafePins.handler.slice(2).toLowerCase()};
 assert.equal((await readSeaportSafeState(rpc,safe,1n,codec)).nonce,"7");
 for(const mutation of[{getThreshold:1n},{getOwners:[...ownerAddresses.slice(0,2),ownerAddresses[0]]},{getModulesPaginated:[[payer],"0x0000000000000000000000000000000000000001"]}])await assert.rejects(readSeaportSafeState({...rpc,readContract:async({functionName})=>({...state,...mutation})[functionName]},safe,1n,codec));
 for(const raw of[undefined,null,"0x0","0xef0100"+payer.slice(2)])await assert.rejects(readSeaportSafeState({...rpc,request:async()=>raw},safe,1n,codec));
 assert.equal((await readSeaportSafeState(rpc,safe,"pending",codec)).nonce,"7");
 await assert.rejects(readSeaportSafeState({...rpc,getStorageAt:async()=>v.zeroHash},safe,1n,codec));
 await assert.rejects(readSeaportSafeState(rpc,safe,1n,{...codec,keccak256:()=>v.zeroHash}));
});
