import test from "node:test";
import assert from "node:assert/strict";
import {createNativeOwnerImportFeed} from "./native-order-feed.mjs";
const catalog="0x"+"11".repeat(32),binding={nativeAdmission:{sourceId:"owner-supplied",policyCatalogHash:catalog}};
test("host import adapter snapshots bounded bytes and deduplicates without claiming public listing or current proof",async()=>{
 const source=["synthetic raw order A","synthetic raw order A","synthetic raw order B"],read=createNativeOwnerImportFeed({policyCatalogHash:catalog,readImports:async()=>source});
 const result=await read({binding});assert.equal(result.status,"AVAILABLE");assert.equal(result.entries.length,2);assert.equal(result.publicListingVerified,false);assert.equal(result.executionEnabled,false);
 source[0]="changed";assert.equal(result.entries[0].rawUtf8,"synthetic raw order A");assert.equal(result.entries[0].sourceId,"owner-supplied");assert.equal(result.currentOrderIndependentlyVerified,undefined);assert.ok(Object.isFrozen(result.entries[0]));
});
test("unknown source/catalog binding fails before any source read",async()=>{let calls=0;const read=createNativeOwnerImportFeed({policyCatalogHash:catalog,readImports:async()=>{calls++;return[];}});for(const b of[{}, {nativeAdmission:{sourceId:"opensea",policyCatalogHash:catalog}},{nativeAdmission:{sourceId:"owner-supplied",policyCatalogHash:"0x"+"22".repeat(32)}}])assert.equal((await read({binding:b})).reason,"SOURCE_POLICY_BINDING_MISMATCH");assert.equal(calls,0);});
test("missing, oversized, object and URL inputs cannot become verified orders",async()=>{
 for(const imports of[undefined,{},Array(9).fill("a"),[{}],["a".repeat(32768)],["é".repeat(17000)]]){const result=await createNativeOwnerImportFeed({policyCatalogHash:catalog,readImports:async()=>imports})({binding});assert.equal(result.status,"UNAVAILABLE");assert.deepEqual(result.entries,[]);}
 // URLs remain unverified bytes and are rejected by the strict JSON importer.
 const result=await createNativeOwnerImportFeed({policyCatalogHash:catalog,readImports:async()=>["https://example.invalid/not-an-order"]})({binding});assert.equal(result.entries[0].rawUtf8,"https://example.invalid/not-an-order");assert.equal(result.currentOrderIndependentlyVerified,undefined);
});
test("empty imports, outage and cancellation have distinct fail-closed outcomes",async()=>{
 assert.equal((await createNativeOwnerImportFeed({policyCatalogHash:catalog,readImports:async()=>[]})({binding})).status,"AVAILABLE");
 assert.equal((await createNativeOwnerImportFeed({policyCatalogHash:catalog,readImports:async()=>{throw Error("private error");}})({binding})).reason,"OWNER_IMPORT_SOURCE_UNAVAILABLE");
 const abort=new AbortController();let calls=0;const read=createNativeOwnerImportFeed({policyCatalogHash:catalog,readImports:async()=>{calls++;abort.abort();return["x"];}});assert.equal((await read({binding,signal:abort.signal})).reason,"SOURCE_READ_ABORTED");assert.equal((await read({binding,signal:abort.signal})).reason,"SOURCE_READ_ABORTED");assert.equal(calls,1);
});
