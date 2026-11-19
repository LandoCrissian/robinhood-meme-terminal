import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {loadSeaportArtifacts} from "./provenance-rebuild.mjs";
import {historicalSeaportTransaction} from "./replay-historical.mjs";
import {createSeaportVerifier,seaportOrderTypes} from "../../packages/launchpad-common/seaport-order-verifier.mjs";
const require=createRequire(new URL("../../apps/indexer/package.json",import.meta.url)),viem=require("viem"),dir=new URL("../../docs/evidence/rmt-task082/seaport-marketplace/",import.meta.url);
const sha=b=>createHash("sha256").update(b).digest("hex"),raw=gunzipSync(readFileSync(new URL("historical-replay-4663.json.gz",dir)),{maxOutputLength:1024*1024}),evidence=JSON.parse(raw),manifest=JSON.parse(readFileSync(new URL("historical-replay-manifest.json",dir))),abi=loadSeaportArtifacts().Seaport.abi,same=(a,b)=>a.toLowerCase()===b.toLowerCase();
test("historical evidence is exact public mined data and never current listing authority",()=>{
 assert.equal(sha(raw),manifest.rawSha256);assert.equal(raw.length,manifest.rawBytes);assert.equal(evidence.transactionHash,historicalSeaportTransaction);assert.equal(evidence.status,"BLOCKED_NO_BROADCAST");
 for(const key of ["currentListingVerified","executionApproved","broadcast","newOwnerSignature"])assert.equal(evidence[key],false);
 assert.equal(Object.keys(evidence.providers).length,2);assert.equal(evidence.currentAnchor,"118324433");
});
test("both actual provider inputs decode and bind the canonical receipt and exact fill fractions",()=>{
 const points=Object.values(evidence.providers);assert.equal(points[0].transaction.value.input,points[1].transaction.value.input);
 for(const point of points){const tx=point.transaction.value,r=point.receipt.value;assert.equal(tx.hash,historicalSeaportTransaction);assert.equal(r.transactionHash,tx.hash);assert.equal(r.status,"0x1");assert.equal(tx.blockHash,r.blockHash);assert.equal(point.canonicalHeader.value.hash,r.blockHash);assert.equal(BigInt(r.blockNumber),115258144n);
  const decoded=viem.decodeFunctionData({abi,data:tx.input});assert.equal(decoded.functionName,"fulfillAdvancedOrder");const [a,resolvers]=decoded.args;assert.equal(a.parameters.orderType,3);assert.equal(a.numerator,1n);assert.equal(a.denominator,2n);assert.equal(a.parameters.offer[0].itemType,1);assert.equal(a.parameters.consideration[0].itemType,4);assert.equal(resolvers.length,1);assert.equal(resolvers[0].identifier,408n);assert.equal(resolvers[0].criteriaProof.length,0);
  const events=viem.parseEventLogs({abi,eventName:"OrderFulfilled",logs:r.logs.filter(l=>same(l.address,tx.to)),strict:true});assert.equal(events.length,1);assert.equal(events[0].args.orderHash,"0x43a7a74fc97f32219eb11fcf4f18f259403fd324a780462f8aee72fb5a55f386");assert.equal(events[0].args.offer[0].amount,900000000000000n);assert.equal(events[0].args.consideration[0].identifier,408n);assert.equal(events[0].args.consideration[0].amount,1n);assert.equal(events[0].args.consideration[1].amount,9000000000000n);assert.equal(events[0].args.consideration[2].amount,90000000000000n);
 }
});
test("actual archive counter, EIP712 domain and seller signature reproduce the onchain order hash",async()=>{
 assert.equal(evidence.providers.official.historicalCounter.status,"unavailable");const p=evidence.providers.pocket,a=p.decoded.advancedOrder,n=Number(a.parameters.totalOriginalConsiderationItems),{totalOriginalConsiderationItems:_count,...terms}=a.parameters;
 assert.equal(p.historicalCounter.status,"observed");assert.equal(p.historicalCounter.value,"0");const components={...terms,consideration:terms.consideration.slice(0,n),counter:BigInt(p.historicalCounter.value)},domain={name:"Seaport",version:"1.6",chainId:4663,verifyingContract:p.transaction.value.to};
 const orderHash=viem.hashStruct({data:components,primaryType:"OrderComponents",types:seaportOrderTypes}),digest=viem.hashTypedData({domain,types:seaportOrderTypes,primaryType:"OrderComponents",message:components}),recovered=await viem.recoverAddress({hash:digest,signature:a.signature});assert.equal(orderHash,p.orderFulfilled.args.orderHash);assert.equal(orderHash,p.signature.onchainHash.value);assert.equal(digest,p.signature.digest);assert.ok(same(recovered,a.parameters.offerer));
 assert.notEqual(viem.hashTypedData({domain:{...domain,chainId:31337},types:seaportOrderTypes,primaryType:"OrderComponents",message:components}),digest);
});
test("strict adapter rejects the genuine historical restricted criteria bid while current fill is only observed",()=>{
 const p=evidence.providers.pocket,a=p.decoded.advancedOrder,v=createSeaportVerifier(viem);assert.throws(()=>v.normalizeSeaportOrder({chainId:4663,seaport:p.transaction.value.to,counter:p.historicalCounter.value,signature:a.signature,parameters:a.parameters}),error=>error.code==="UNSUPPORTED_ORDER_TYPE_OR_ZONE");
 for(const point of Object.values(evidence.providers)){assert.equal(point.currentStatus.status,"observed");assert.deepEqual(point.currentStatus.value,[true,false,"1","2"]);assert.equal(BigInt(point.currentHeader.value.number),BigInt(evidence.currentAnchor));}
 assert.equal(evidence.currentListingVerified,false);assert.equal(evidence.providers.official.trace.status,"unavailable");const trace=p.trace;assert.equal(trace.status,"observed");assert.ok(trace.bytes<=1024*1024);assert.ok(same(trace.value.input,p.transaction.value.input));assert.ok(same(trace.value.from,p.transaction.value.from));assert.ok(same(trace.value.to,p.transaction.value.to));assert.equal(trace.value.error,undefined);
});
test("all twenty raw scanner observations remain individually bound to public token/conduit identities",()=>{
 const reportRaw=gunzipSync(readFileSync(new URL("historical-raw-gitleaks-report.json.gz",dir)),{maxOutputLength:1024*1024}),rows=JSON.parse(reportRaw),lines=raw.toString().split(/\r?\n/),known=["0x0bd7d308f8e1639fab988df18a8011f41eacad73","0x7a543c61c021e9a5c7949fabdc2f4e0a58088daf","0x61159fefdfada89302ed55f8b9e89e2d67d8258712b3a3f89aa88525877f1d5e"];
 assert.equal(sha(reportRaw),manifest.rawScannerReportSha256);assert.equal(rows.length,20);assert.equal(manifest.scanner.exitCode,1);assert.equal(manifest.scanner.unclassified,0);assert.equal(manifest.scanner.suppressionsAdded,false);assert.equal(rows.length,manifest.classifications.length);
 for(let i=0;i<rows.length;i++){const r=rows[i],c=manifest.classifications[i],line=lines[c.line-1],m=line.match(/"(token|conduitKey|fulfillerConduitKey)": "(0x[0-9a-fA-F]+)"/);assert.equal(r.RuleID,c.ruleId);assert.equal(r.StartLine,c.line);assert.equal(sha(line),c.lineSha256);assert.equal(sha(m[2]),c.publicValueSha256);assert.ok(known.includes(m[2].toLowerCase()));}
});
