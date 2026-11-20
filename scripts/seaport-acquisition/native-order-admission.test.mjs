// Ephemeral test-key signatures; RPC/state/unsigned simulation are mocked.
// Genuine pinned Seaport acceptance remains a separate fork/browser suite.
import assert from "node:assert/strict";
import {test} from "node:test";
import {createOwnerWatcherInteropFixture} from "./owner-watcher-interop-fixture.mjs";
import {createNativeOwnerImportFeed} from "./native-order-feed.mjs";
import {createReadOnlySeaportWatcher} from "./listing-watcher.mjs";
import {ingestNativeOwnerSuppliedSignedOrder,verifyNativeOwnerOrderEntry,parseNativeOwnerSuppliedOrder,createSyntheticNativeCollectionPolicy,nativeProductionCollectionPolicies,nativeCollectionPolicyCatalogHash} from "./native-order-admission.mjs";
const zero="0x"+"00".repeat(20),clone=x=>structuredClone(x);
async function fixture(chainId=31337){
 const f=await createOwnerWatcherInteropFixture({chainId});
 const options={profile:chainId===31337?"seaport-local-31337-v1":"robinhood-4663-read-only-v1",nowMs:f.controls.clock,sourceId:"owner-supplied",collectionPolicies:[clone(createSyntheticNativeCollectionPolicy(f.verifierOptions.pins.collections[0]))],verifierOptions:f.verifierOptions};
 return {...f,nativeOptions:options,bytes:()=>JSON.stringify(f.envelope),entry:()=>({sourceKind:"OWNER_SUPPLIED",sourceId:"owner-supplied",rawUtf8:JSON.stringify(f.envelope)})};
}
test("native import reuses actual strict parser/current verifier and binds synthetic source policy to canonical all-in ETH evidence",async()=>{
 const f=await fixture(),p=await verifyNativeOwnerOrderEntry(f.entry(),f.nativeOptions);
 assert.equal(p.status,"OWNER_SUPPLIED_CURRENT_ORDER_VERIFIED",JSON.stringify(p));assert.equal(p.currentOrderIndependentlyVerified,true);
 assert.equal(p.publicListingVerified,false);assert.equal(p.executionEnabled,false);assert.equal(p.executionApproved,false);assert.equal(p.productionStatus,"NO_GO");
 assert.equal(p.nativeAdmission.profile,"rmt-native-order-admission-v1");assert.equal(p.nativeAdmission.native,true);assert.equal(p.nativeAdmission.totalWei,"1000");assert.equal(p.nativeAdmission.policyCatalogHash,nativeCollectionPolicyCatalogHash(f.nativeOptions.collectionPolicies));assert.equal(p.nativeAdmission.scope,"SYNTHETIC_LOCAL_FIXTURE_ONLY");assert.equal(p.nativeAdmission.productionApproved,false);
 assert.equal(p.nativeAdmission.orderHash,p.orderHash);assert.deepEqual(p.nativeAdmission.observed,p.observed);assert.equal(p.nativeAdmission.rawSha256,p.provenance.rawSha256);
 assert.equal(p.nativeAdmission.payment.kind,"NATIVE_ETH");assert.equal(p.nativeAdmission.payment.valueWei,"1000");assert.equal(p.nativeAdmission.payment.signedConsiderationWei,p.verified.payment.totalWei);assert.equal(p.nativeAdmission.payment.currency,zero);assert.equal(p.nativeAdmission.payment.networkFeeIncluded,false);assert.equal(p.nativeAdmission.payment.networkFeeStatus,"NOT_ESTIMATED");
 assert.equal(p.nativeAdmission.collection.runtimeHash,f.verifierOptions.pins.collections[0].runtimeHash);assert.match(p.nativeAdmission.collectionPolicyHash,/^0x[0-9a-f]{64}$/);
 assert.equal(f.counters.prepare,0);assert.equal(f.counters.commit,0);assert.match(p.limitations.join(" " ),/mint\/fault/);
});
test("native-only import rejects token payment before current-state reads, even with old synthetic payment option",async()=>{
 const f=await fixture();f.envelope.order.parameters.consideration[0].itemType=1;f.envelope.order.parameters.consideration[0].token=f.configuration.projectToken;
 assert.throws(()=>parseNativeOwnerSuppliedOrder(f.bytes(),f.nativeOptions),/NATIVE_ETH_ONLY/);
 assert.equal((await ingestNativeOwnerSuppliedSignedOrder(f.bytes(),f.nativeOptions)).reason,"NATIVE_ETH_ONLY");
 assert.equal((await ingestNativeOwnerSuppliedSignedOrder(f.bytes(),{...f.nativeOptions,paymentProfile:"immutable-synthetic-local"})).reason,"UNKNOWN_NATIVE_ADMISSION_OPTION");
 assert.equal(f.counters.orderRpcReads,0);
});
test("no source, missing review, duplicate policies and arbitrary production policies remain unavailable",async()=>{
 for(const mutate of[o=>delete o.sourceId,o=>o.sourceId="public-feed",o=>delete o.collectionPolicies,o=>o.collectionPolicies=[],o=>o.collectionPolicies.push(clone(o.collectionPolicies[0])),o=>o.collectionPolicies[0].issuerPolicy="SAFE"]){
  const f=await fixture();mutate(f.nativeOptions);const r=await ingestNativeOwnerSuppliedSignedOrder(f.bytes(),f.nativeOptions);assert.equal(r.status,"UNAVAILABLE",JSON.stringify(r));assert.equal(r.currentOrderIndependentlyVerified,false);assert.equal(f.counters.orderRpcReads,0);
 }
 const live=await fixture(4663);assert.equal((await ingestNativeOwnerSuppliedSignedOrder(live.bytes(),live.nativeOptions)).reason,"CALLER_PRODUCTION_POLICY_FORBIDDEN");
 delete live.nativeOptions.collectionPolicies;assert.equal((await ingestNativeOwnerSuppliedSignedOrder(live.bytes(),live.nativeOptions)).reason,"COLLECTION_POLICY_UNAVAILABLE");assert.equal(live.counters.orderRpcReads,0);assert.deepEqual(nativeProductionCollectionPolicies,[]);assert.ok(Object.isFrozen(nativeProductionCollectionPolicies));
});
test("source entry is explicit and closed to public labels, URLs, order objects and unknown fields",async()=>{
 for(const change of[e=>e.sourceKind="PUBLIC",e=>e.sourceId="opensea",e=>e.url="https://opensea.io",e=>e.rawUtf8={},e=>delete e.sourceId]){
  const f=await fixture(),e=f.entry();change(e);const r=await verifyNativeOwnerOrderEntry(e,f.nativeOptions);assert.equal(r.reason,"SOURCE_ENTRY_UNADMITTED");assert.equal(f.counters.orderRpcReads,0);
 }
 const f=await fixture();assert.equal((await verifyNativeOwnerOrderEntry({...f.entry(),rawUtf8:"https://opensea.io/collection/no-order"},f.nativeOptions)).status,"UNAVAILABLE");
});
test("review catalog binds exact chain, collection, standard, source/runtime, policy and issuer/upgrade classifications",async()=>{
 for(const mutate of[p=>p.address="0x"+"77".repeat(20),p=>p.chainId=4663,p=>p.standard=1155,p=>p.runtimeHash="0x"+"11".repeat(32),p=>p.sourceInputSha256="0x"+"22".repeat(32),p=>p.proxy="UNKNOWN",p=>p.upgradePolicy="UNKNOWN",p=>p.transferPolicy="UNKNOWN",p=>p.royaltyPolicy="NONE",p=>p.sourceReview="CALLER_APPROVED",p=>p.extra="true",p=>p.policyHash="0x"+"33".repeat(32)]){
  const f=await fixture();mutate(f.nativeOptions.collectionPolicies[0]);assert.equal((await ingestNativeOwnerSuppliedSignedOrder(f.bytes(),f.nativeOptions)).status,"UNAVAILABLE");
 }
 const f=await fixture();assert.throws(()=>createSyntheticNativeCollectionPolicy({...f.verifierOptions.pins.collections[0],proxy:true}),/INVALID_SYNTHETIC_COLLECTION_PIN/);
 assert.throws(()=>createSyntheticNativeCollectionPolicy({...f.verifierOptions.pins.collections[0],sourceVerified:false}),/INVALID_SYNTHETIC_COLLECTION_PIN/);
});
test("native import rechecks cancellation, counter, seller approval, ownership, code and canonical reorg after success",async()=>{
 for(const mutate of[f=>f.controls.cancelled=true,f=>f.controls.counter=1n,f=>f.controls.approved=false,f=>f.controls.owner=f.configuration.projectToken,f=>f.controls.sellerCode="0xef0100"+"44".repeat(20),f=>f.controls.totalFilled=1n]){
  const f=await fixture();assert.equal((await ingestNativeOwnerSuppliedSignedOrder(f.bytes(),f.nativeOptions)).status,"OWNER_SUPPLIED_CURRENT_ORDER_VERIFIED");const before=f.counters.orderRpcReads;mutate(f);
  const r=await ingestNativeOwnerSuppliedSignedOrder(f.bytes(),f.nativeOptions);assert.equal(r.status,"UNAVAILABLE",JSON.stringify(r));assert.ok(f.counters.orderRpcReads>before);assert.equal(r.nativeAdmission,undefined);
 }
 const f=await fixture();let count=0;for(const rpc of[f.verifierOptions.rpc,f.verifierOptions.witnessRpc])rpc.getBlock=async()=>({number:123n,hash:++count>2?"0x"+"88".repeat(32):f.state.canonical.hash,timestamp:BigInt(f.state.canonical.timestamp)});
 assert.equal((await ingestNativeOwnerSuppliedSignedOrder(f.bytes(),f.nativeOptions)).reason,"CANONICAL_BLOCK_CHANGED");
});
test("mutation, stale provenance and missing independent evidence never inherit prior verified labels",async()=>{
 for(const change of[f=>f.envelope.order.parameters.consideration[0].startAmount="999",f=>f.envelope.provenance.obtainedAt="2000-01-01T00:00:00.000Z",f=>delete f.verifierOptions.witnessRpc,f=>f.verifierOptions.pins.collections[0].sourceInputSha256="0x"+"99".repeat(32),f=>f.controls.rpcAvailable=false]){
  const f=await fixture();change(f);const r=await ingestNativeOwnerSuppliedSignedOrder(f.bytes(),f.nativeOptions);assert.equal(r.status,"UNAVAILABLE",JSON.stringify(r));assert.equal(r.nativeAdmission,undefined);assert.equal(r.executionEnabled,false);
 }
});
test("review and policy inputs are snapshotted before asynchronous external reads",async()=>{
 const f=await fixture();const original=f.verifierOptions.rpc.getChainId;
 f.verifierOptions.rpc.getChainId=async()=>{f.verifierOptions.review.expectedConsideration[0].amountWei="999";f.verifierOptions.pins.collections[0].sourceInputSha256="0x"+"99".repeat(32);f.nativeOptions.collectionPolicies[0].issuerPolicy="MUTATED_DURING_READ";return original();};
 const r=await ingestNativeOwnerSuppliedSignedOrder(f.bytes(),f.nativeOptions);assert.equal(r.status,"OWNER_SUPPLIED_CURRENT_ORDER_VERIFIED",JSON.stringify(r));assert.equal(r.nativeAdmission.payment.signedConsiderationWei,"1000");assert.equal(r.verified.payment.consideration[0].amountWei,"1000");
});

test("catalog fingerprint is ordering-independent and includes every admitted policy field",async()=>{const f=await fixture(),p=f.nativeOptions.collectionPolicies[0],other={...p,address:f.configuration.projectToken};assert.equal(nativeCollectionPolicyCatalogHash([p,other]),nativeCollectionPolicyCatalogHash([other,p]));assert.notEqual(nativeCollectionPolicyCatalogHash([p]),nativeCollectionPolicyCatalogHash([{...p,sourceReview:"MUTATED"}]));assert.throws(()=>nativeCollectionPolicyCatalogHash([p,p]),/DUPLICATE_COLLECTION_POLICY/);assert.match(nativeCollectionPolicyCatalogHash([]),/^0x[0-9a-f]{64}$/);});

test("import failure reasons never reflect untrusted JSON or provider URL credentials",async()=>{
 const f=await fixture(),marker="SYNTHETIC_PRIVATE_CREDENTIAL_NOT_REAL";f.verifierOptions.rpc.getChainId=async()=>{throw Error("RPC https://mock.invalid/?token="+marker);};
 const result=await ingestNativeOwnerSuppliedSignedOrder(f.bytes(),f.nativeOptions);assert.equal(result.reason,"NATIVE_ORDER_ADMISSION_UNAVAILABLE");assert.equal(JSON.stringify(result).includes(marker),false);
 const malformed=await ingestNativeOwnerSuppliedSignedOrder(marker,f.nativeOptions);assert.equal(malformed.reason,"NATIVE_ORDER_ADMISSION_UNAVAILABLE");assert.equal(JSON.stringify(malformed).includes(marker),false);
});

async function nativeWatcherFixture(chainId=31337){
 const f=await fixture(chainId),catalog=chainId===31337?f.nativeOptions.collectionPolicies:[],catalogHash=nativeCollectionPolicyCatalogHash(catalog);
 f.options.configuration={...f.options.configuration,profile:chainId===31337?"seaport-watch-native-31337-v1":"seaport-watch-native-4663-read-only-v1",nativeAdmission:{sourceId:"owner-supplied",policyCatalogHash:catalogHash}};
 f.options.discover=createNativeOwnerImportFeed({policyCatalogHash:catalogHash,readImports:async()=>{f.counters.discover++;if(!f.controls.sourceAvailable)throw Error("MOCK_OWNER_IMPORT_UNAVAILABLE");return[f.bytes(),f.bytes()];}});
 f.options.verifyEntry=async entry=>{f.counters.verify++;const options={...f.nativeOptions,nowMs:f.controls.clock};if(chainId===4663)delete options.collectionPolicies;return verifyNativeOwnerOrderEntry(entry,options);};
 return f;
}
test("actual native import and bounded feed produce one catalog-bound local unsigned watcher candidate, with restart and duplicate recovery",async()=>{
 const f=await nativeWatcherFixture(),watcher=createReadOnlySeaportWatcher(f.options),first=await watcher.tick();
 assert.equal(first.status,"PREPARED",JSON.stringify(first));assert.equal(first.candidate.sourceEntry.sourceId,"owner-supplied");assert.equal(first.candidate.sourceEntry.sourceKind,"OWNER_SUPPLIED");
 assert.equal(watcher.binding.nativeAdmission.policyCatalogHash,nativeCollectionPolicyCatalogHash(f.nativeOptions.collectionPolicies));
 assert.equal(first.candidate.orderHash,f.verifierOptions.review.expectedOrderHash);assert.equal(first.candidate.request.value,"0x0","Vault pays signed consideration; caller transaction value stays zero");
 assert.equal(first.candidate.maximumNetworkFeeWei,"42000");assert.equal(first.executionEnabled,false);assert.equal(first.broadcast,false);assert.equal(first.signatureRequested,false);
 assert.equal(f.saved().records.length,1);assert.equal(f.counters.prepare,1);assert.equal(f.counters.verify,2);
 f.advance();const duplicate=await createReadOnlySeaportWatcher(f.options).tick({force:true});assert.equal(duplicate.reason,"ORDER_ALREADY_PREPARED",JSON.stringify(duplicate));assert.equal(f.counters.prepare,1);assert.equal(f.saved().records.length,1);
 assert.deepEqual(f.saved().records[0].request,first.candidate.request);assert.ok(f.counters.verify>2,"Restart must re-read current seller signature/counter/status/approval");
});
test("actual native import RPC outage keeps its original unsigned request pending across restart, then revalidates without new preparation",async()=>{
 const f=await nativeWatcherFixture(),first=await createReadOnlySeaportWatcher(f.options).tick();assert.equal(first.status,"PREPARED");
 f.advance();f.controls.rpcAvailable=false;const interrupted=await createReadOnlySeaportWatcher(f.options).tick({force:true});
 assert.equal(interrupted.reason,"ORIGINAL_PROPOSAL_EVIDENCE_PENDING",JSON.stringify(interrupted));assert.equal(f.saved().records[0].status,"PENDING_EVIDENCE");
 assert.deepEqual(f.saved().records[0].request,first.candidate.request);assert.equal(f.counters.prepare,1);
 f.controls.rpcAvailable=true;f.advance();const recovered=await createReadOnlySeaportWatcher(f.options).tick({force:true});assert.equal(recovered.reason,"ORDER_ALREADY_PREPARED",JSON.stringify(recovered));
 assert.equal(f.saved().records[0].status,"PREPARED");assert.equal(f.counters.prepare,1);assert.equal(f.saved().records.length,1);
});
test("native feed catalog mismatch and unavailable owner import cannot prepare requests",async()=>{
 for(const kind of["catalog","outage"]){
  const f=await nativeWatcherFixture();if(kind==="catalog")f.options.configuration.nativeAdmission.policyCatalogHash="0x"+"aa".repeat(32);else f.controls.sourceAvailable=false;
  const r=await createReadOnlySeaportWatcher(f.options).tick();assert.equal(r.reason,"LISTING_FEED_UNAVAILABLE",JSON.stringify(r));assert.equal(f.counters.verify,0);assert.equal(f.counters.prepare,0);assert.equal(f.saved().records.length,0);
 }
});
test("native watcher rejects public-source labels and legacy non-native admission proofs",async()=>{
 const publicEntry=await nativeWatcherFixture();publicEntry.options.discover=async()=>({status:"AVAILABLE",entries:[{...publicEntry.entry(),sourceKind:"PUBLIC"}]});
 const deniedPublic=await createReadOnlySeaportWatcher(publicEntry.options).tick();assert.equal(deniedPublic.reason,"NATIVE_SOURCE_UNADMITTED");assert.equal(publicEntry.counters.verify,0);assert.equal(publicEntry.counters.prepare,0);
 const legacy=await nativeWatcherFixture();legacy.options.verifyEntry=async()=>legacy.ownerProof();
 const deniedLegacy=await createReadOnlySeaportWatcher(legacy.options).tick();assert.equal(deniedLegacy.reason,"NATIVE_SOURCE_POLICY_UNVERIFIED",JSON.stringify(deniedLegacy));assert.equal(legacy.counters.prepare,0);
 const changed=await nativeWatcherFixture(),actual=changed.options.verifyEntry;changed.options.verifyEntry=async entry=>{const proof=await actual(entry);if(proof.nativeAdmission)proof.nativeAdmission.policyCatalogHash="0x"+"bb".repeat(32);return proof;};
 const deniedCatalog=await createReadOnlySeaportWatcher(changed.options).tick();assert.equal(deniedCatalog.reason,"NATIVE_SOURCE_POLICY_UNVERIFIED");assert.equal(changed.counters.prepare,0);
});
test("native watcher honors mined OFF, canonical reorg and controller authority fingerprint without preparing duplicates",async()=>{
 for(const kind of["OFF","reorg","controller"]){
  const f=await nativeWatcherFixture();assert.equal((await createReadOnlySeaportWatcher(f.options).tick()).status,"PREPARED");f.advance();
  if(kind==="OFF")f.state.purchasesEnabled=false;else if(kind==="reorg")f.controls.canonical=false;else f.state.controllerAuthorityHash="0x"+"cc".repeat(32);
  const next=await createReadOnlySeaportWatcher(f.options).tick({force:true});assert.notEqual(next.status,"PREPARED");assert.equal(f.saved().records[0].status,"INVALIDATED");assert.equal(f.counters.prepare,1);
  if(kind==="OFF"){f.state.purchasesEnabled=true;f.advance();const resumed=await createReadOnlySeaportWatcher(f.options).tick({force:true});assert.equal(resumed.reason,"NO_ADMITTED_NEW_ORDER");assert.equal(f.counters.prepare,1,"Invalidated original order is not silently prepared again");}
 }
});
test("actual native chain4663 import remains blocked by empty production policy catalog and never emits an unsigned purchase",async()=>{
 const f=await nativeWatcherFixture(4663),r=await createReadOnlySeaportWatcher(f.options).tick();
 assert.equal(r.reason,"NO_ADMITTED_NEW_ORDER",JSON.stringify(r));assert.equal(f.counters.prepare,0);assert.equal(f.saved().records.length,0);assert.equal(r.executionEnabled,false);assert.equal(r.broadcast,false);assert.equal(r.signatureRequested,false);
 const options={...f.nativeOptions};delete options.collectionPolicies;const proof=await verifyNativeOwnerOrderEntry(f.entry(),options);assert.equal(proof.reason,"COLLECTION_POLICY_UNAVAILABLE");assert.equal(proof.currentOrderIndependentlyVerified,false);
});
