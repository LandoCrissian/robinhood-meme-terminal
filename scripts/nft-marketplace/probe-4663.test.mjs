import assert from "node:assert/strict";
import test from "node:test";
import {boundedPublicRead,marketplacePins,officialSources} from "./probe-4663.mjs";
test("provenance probe has fixed read-only targets, rejects SSRF and never follows redirects",async()=>{
 let calls=0;await assert.rejects(boundedPublicRead("http://127.0.0.1/admin",async()=>{calls++;}));await assert.rejects(boundedPublicRead("https://api.opensea.io/api/v2/collections/attacker",async()=>{calls++;}));assert.equal(calls,0);
 const result=await boundedPublicRead(officialSources.sdkChain,async(url,options)=>{calls++;assert.equal(options.redirect,"error");assert.equal(options.method,undefined);assert.equal(options.headers.Authorization,undefined);return new Response("source",{status:200});});assert.equal(result.status,"observed");assert.equal(result.bytes,6);assert.equal(calls,1);
 const redirect=await boundedPublicRead(officialSources.sdkChain,async()=>new Response(null,{status:302}));assert.equal(redirect.status,"unavailable");assert.equal(redirect.httpStatus,302);
});
test("HTTP success is only a bounded observation, not marketplace execution or source verification",async()=>{
 const oversize=await boundedPublicRead(officialSources.sdkChain,async()=>new Response("a".repeat(2*1024*1024+1)));assert.equal(oversize.status,"unavailable");
 assert.equal(marketplacePins.seaport,"0x0000000000000068F116a894984e2DB1123eB395");assert.ok(!Object.keys(marketplacePins).includes("executionEnabled"));
});
