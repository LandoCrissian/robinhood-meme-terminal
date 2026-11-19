// Real ephemeral EOA signatures and actual ingestion/adapter code; RPC, public
// HTTP response and transaction simulation are mocked. No live listing claim.
import assert from "node:assert/strict";
import {test} from "node:test";
import {createReadOnlySeaportWatcher} from "./listing-watcher.mjs";
import {createOwnerWatcherInteropFixture} from "./owner-watcher-interop-fixture.mjs";
import {seaportVaultSignatures} from "../../packages/launchpad-common/seaport-vault-runtime.mjs";

test("real owner EIP712 signature + actual ingestion amountWei interoperates with mocked-RPC watcher",async()=>{
 const f=await createOwnerWatcherInteropFixture(),proof=await f.ownerProof();assert.equal(proof.status,"OWNER_SUPPLIED_CURRENT_ORDER_VERIFIED",JSON.stringify(proof));assert.equal(proof.verified.payment.consideration[0].amountWei,"1000");assert.equal(Object.hasOwn(proof.verified.payment.consideration[0],"amount"),false);
 const w=createReadOnlySeaportWatcher(f.options),r=await w.tick();assert.equal(r.status,"PREPARED",JSON.stringify(r));assert.equal(r.candidate.orderHash,proof.orderHash);assert.equal(r.executionEnabled,false);assert.equal(r.broadcast,false);assert.equal(r.signatureRequested,false);assert.equal(r.candidate.publicListingVerified,false);assert.equal(f.counters.prepare,1);
 const decoded=f.options.codecs.decodeFunctionData({abi:f.options.codecs.parseAbi(seaportVaultSignatures),data:r.candidate.request.data});assert.equal(decoded.functionName,"purchase");assert.equal(decoded.args[1].signedOrderHash,proof.orderHash);assert.equal(decoded.args[0].signature,f.order.signature);
});
for(const [name,change]of[["seller cancellation",f=>f.controls.cancelled=true],["seller counter",f=>f.controls.counter=1n],["seller NFT approval",f=>f.controls.approved=false],["seller NFT ownership",f=>f.controls.owner=f.configuration.projectToken]]){
 test(name+" drift re-runs actual ingestion and cannot leave a durable PREPARED request",async()=>{
  const f=await createOwnerWatcherInteropFixture(),w=createReadOnlySeaportWatcher(f.options),first=await w.tick();assert.equal(first.status,"PREPARED");const before=f.counters.verify,request=structuredClone(first.candidate.request);f.advance();change(f);
  const proof=await f.ownerProof();assert.equal(proof.currentOrderIndependentlyVerified,false,"actual current-order verifier must see the drift");
  const later=await w.tick({force:true});assert.notEqual(later.status,"PREPARED");assert.ok(f.counters.verify>before,"prepared-record path must reverify current order");assert.notEqual(f.saved().records[0].status,"PREPARED");assert.deepEqual(f.saved().records[0].request,request);assert.equal(f.counters.prepare,1,"no new unsigned emission");
 });
}
test("order evidence outage leaves original request PENDING_EVIDENCE through restart without another preparation",async()=>{
 const f=await createOwnerWatcherInteropFixture(),first=await createReadOnlySeaportWatcher(f.options).tick();assert.equal(first.status,"PREPARED");f.advance();f.controls.rpcAvailable=false;
 const current=await f.ownerProof();assert.equal(current.status,"UNAVAILABLE");assert.equal(current.reason,"MOCK_RPC_UNAVAILABLE");
 const restarted=createReadOnlySeaportWatcher(f.options),later=await restarted.tick({force:true});assert.notEqual(later.status,"PREPARED");assert.equal(f.saved().records[0].status,"PENDING_EVIDENCE");assert.deepEqual(f.saved().records[0].request,first.candidate.request);assert.equal(f.counters.prepare,1);
});
test("actual bounded public adapter's missing observed.chainId is normalized only from verified.chainId",async()=>{
 const f=await createOwnerWatcherInteropFixture({chainId:4663}),publicProof=await f.publicProof();assert.equal(publicProof.status,"CURRENT_ORDER_INDEPENDENTLY_VERIFIED",JSON.stringify(publicProof));assert.equal(publicProof.verified.orderVerified,true);assert.equal(publicProof.verified.chainId,4663);assert.equal(publicProof.verified.observed.chainId,undefined);
 f.options.discover=async()=>({status:"AVAILABLE",entries:[f.publicEntry]});const w=createReadOnlySeaportWatcher(f.options),r=await w.tick();assert.equal(r.reason,"PRODUCTION_VAULT_NOT_RELEASED",JSON.stringify(r));assert.equal(r.executionEnabled,false);assert.equal(f.counters.prepare,0);
 const missing=await createOwnerWatcherInteropFixture({chainId:4663});missing.options.discover=async()=>({status:"AVAILABLE",entries:[missing.publicEntry]});missing.options.verifyEntry=async entry=>{const proof=await missing.publicProof(entry);delete proof.verified.chainId;return proof;};const noChain=await createReadOnlySeaportWatcher(missing.options).tick();assert.equal(noChain.status,"UNAVAILABLE");assert.equal(missing.counters.prepare,0,"order.chainId alone must not close missing verified observation chain");
});
test("OFF, current reorg and controller/keeper authority drift cannot emit another request",async()=>{
 for(const kind of["OFF","reorg","controller","nonce"]){const f=await createOwnerWatcherInteropFixture(),w=createReadOnlySeaportWatcher(f.options);assert.equal((await w.tick()).status,"PREPARED");f.advance();if(kind==="OFF")f.state.purchasesEnabled=false;else if(kind==="reorg")f.controls.canonical=false;else if(kind==="controller")f.state.controllerAuthorityHash="0x"+"33".repeat(32);else{f.state.gasPayer.latestNonce="1";f.state.gasPayer.pendingNonce="1";}const r=await w.tick({force:true});assert.notEqual(r.status,"PREPARED");assert.notEqual(f.saved().records[0].status,"PREPARED");assert.equal(f.counters.prepare,1);}
});
