import assert from "node:assert/strict";
import {createRequire} from "node:module";
import test from "node:test";
import {parseNftCollectionInput,resolveNftCollection} from "./nft-collection-resolver.mjs";
const require=createRequire(new URL("../../apps/launch-website/package.json",import.meta.url));
const {getAddress,isAddress,keccak256,zeroAddress}=require("viem");
const collection=getAddress("0x1234567890abcdef1234567890abcdef12345678"),code="0x60006000",blockHash="0x"+"12".repeat(32),sourceInputSha256="0x"+"34".repeat(32),nowMs=1_800_000_000_000;
function fixture(){
 const knobs={code,chain:31337,headerHash:blockHash,finalHash:blockHash,timestamp:BigInt(nowMs/1000),standard:721,source:{verified:true,chainId:31337,address:collection,runtimeHash:keccak256(code),sourceInputSha256,standard:721,proxy:false}},calls=[];
 const options={chainId:31337,nowMs,paymentAsset:zeroAddress,allowedCurrencies:[zeroAddress],codecs:{getAddress,isAddress,keccak256},
  rpc:{getChainId:async()=>knobs.chain,getBlock:async args=>({number:100n,hash:"blockTag"in args?knobs.headerHash:knobs.finalHash,timestamp:knobs.timestamp}),getCode:async args=>{calls.push(args);return knobs.code;},readContract:async args=>{calls.push(args);const id=args.args[0];return id==="0x01ffc9a7"||id===(knobs.standard===721?"0x80ac58cd":"0xd9b67a26");}},
  trustedCollectionHint:async slug=>({slug,name:"Synthetic reviewed collection",contracts:[{address:collection,chainId:31337,standard:knobs.standard}]}),verifiedSource:async args=>{calls.push(args);return knobs.source;}};
 return{knobs,options,calls};
}
test("input accepts collection identity, never wallet/profile/item URLs or arbitrary fetch targets",()=>{
 assert.deepEqual(parseNftCollectionInput("https://www.opensea.io/collection/synthetic-only/"),{kind:"opensea-collection",slug:"synthetic-only",canonicalUrl:"https://opensea.io/collection/synthetic-only"});assert.equal(parseNftCollectionInput(collection).address,collection);
 for(const input of["http://opensea.io/collection/test","https://opensea.io.evil.test/collection/test","https://opensea.io@evil.test/collection/test","https://user:pass@opensea.io/collection/test","https://opensea.io/collection/test?redirect=http://127.0.0.1","https://opensea.io/collection/test#x","https://opensea.io/collection/%2e%2e","https://opensea.io/collection/a/b","https://opensea.io/item/robinhood/"+collection+"/1","https://opensea.io/"+collection,"https://opensea.io/collection\\test","https://127.0.0.1/collection/test","https://openseа.io/collection/test"," https://opensea.io/collection/test",zeroAddress,"x".repeat(257)])assert.throws(()=>parseNftCollectionInput(input),undefined,input);
});
test("actual checksum, observed code, ERC165 and independent reviewed-source bindings all precede verified identity",async()=>{
 const{options,knobs,calls}=fixture();const result=await resolveNftCollection("https://opensea.io/collection/synthetic-only",options);assert.equal(result.status,"verified");assert.equal(result.collectionVerified,true);assert.equal(result.contracts[0].address,collection);assert.equal(result.contracts[0].runtimeHash,keccak256(code));assert.equal(result.contracts[0].evidenceBlock,"100");assert.equal(result.contracts[0].sourceInputSha256,sourceInputSha256);assert.ok(calls.every(call=>call.blockNumber===100n));
 assert.equal(result.listingVerified,false);assert.equal(result.routeSupported,false);assert.equal(result.executionAvailable,false);assert.equal(result.purchasesEnabled,false);
 knobs.standard=1155;knobs.source.standard=1155;assert.equal((await resolveNftCollection(collection,options)).contracts[0].standard,1155);
 assert.equal((await resolveNftCollection("0x1234567890AbcDEF1234567890aBCDef12345678",options)).status,"rejected");
});
test("slug collision, missing source, spoofed standards and provider-chain disagreement fail closed",async()=>{
 const{options,knobs}=fixture();
 for(const hint of[{slug:"different",contracts:[{address:collection,chainId:31337}]},{slug:"x",contracts:[]},{slug:"x",contracts:[null]},{slug:"x",contracts:["not-a-contract"]},{slug:"x",contracts:[{address:collection,chainId:31337},{address:collection,chainId:31337}]},{slug:"x",contracts:[{address:collection,chainId:4663}]},{slug:"x",contracts:[{address:collection,chainId:31337,standard:1155}]}]){options.trustedCollectionHint=async()=>hint;assert.notEqual((await resolveNftCollection("https://opensea.io/collection/x",options)).status,"verified");}
 knobs.chain=4663;assert.equal((await resolveNftCollection(collection,options)).code,"PROVIDER_CHAIN_MISMATCH");knobs.chain=31337;
 for(const source of[null,{...knobs.source,verified:false},{...knobs.source,proxy:true},{...knobs.source,runtimeHash:blockHash},{...knobs.source,chainId:4663},{...knobs.source,sourceInputSha256:"0x"+"00".repeat(32)}]){options.verifiedSource=async()=>source;assert.equal((await resolveNftCollection(collection,options)).status,"unavailable");}
});
test("wallet addresses, EIP7702 designators and malformed or contradictory NFT interfaces cannot become collections",async()=>{
 const{options,knobs}=fixture();for(const invalid of[undefined,"0x","0xef0100"+collection.slice(2),"0x600","0xzz"]){knobs.code=invalid;assert.equal((await resolveNftCollection(collection,options)).code,"NOT_A_COLLECTION_CONTRACT");}
 knobs.code=code;for(const answer of[true,false,1,"true"]){options.rpc.readContract=async()=>answer;assert.equal((await resolveNftCollection(collection,options)).code,"UNSUPPORTED_NFT_STANDARD");}
});
test("stale blocks, reorgs, archive outages and unbounded hints never become negative registration claims",async()=>{
 const{options,knobs}=fixture();knobs.timestamp-=301n;assert.equal((await resolveNftCollection(collection,options)).code,"STALE_BLOCK_EVIDENCE");knobs.timestamp=BigInt(nowMs/1000);knobs.finalHash="0x"+"56".repeat(32);assert.equal((await resolveNftCollection(collection,options)).code,"REORG_OR_PROVIDER_DISAGREEMENT");
 options.rpc.getCode=async()=>{throw Error("private upstream details must not escape");};const unavailable=await resolveNftCollection(collection,options);assert.equal(unavailable.status,"unavailable");assert.ok(!JSON.stringify(unavailable).includes("private upstream"));
 options.timeoutMs=100;options.trustedCollectionHint=()=>new Promise(()=>{});assert.equal((await resolveNftCollection("https://opensea.io/collection/x",options)).code,"COLLECTION_METADATA_UNAVAILABLE");
});
test("currency and chain admission remain explicit and no metadata URL is fetched",async()=>{
 const{options,calls}=fixture();assert.equal((await resolveNftCollection(collection,{...options,chainId:1})).code,"UNSUPPORTED_CHAIN");assert.equal((await resolveNftCollection(collection,{...options,paymentAsset:collection})).code,"UNSUPPORTED_PAYMENT_ASSET");assert.equal(calls.length,0);
 let fetches=0;const before=globalThis.fetch;globalThis.fetch=async()=>{fetches++;throw Error("must not fetch metadata");};
 try{options.trustedCollectionHint=async slug=>({slug,name:"Untrusted text only",image_url:"http://169.254.169.254/metadata",contracts:[{address:collection,chainId:31337}]});const result=await resolveNftCollection("https://opensea.io/collection/x",options);assert.equal(result.status,"verified");assert.equal("image_url"in result,false);assert.equal(fetches,0);}finally{globalThis.fetch=before;}
});
