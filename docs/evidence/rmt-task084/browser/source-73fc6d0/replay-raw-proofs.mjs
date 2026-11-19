import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {join,resolve} from "node:path";
import * as safe from "../../../../../packages/launchpad-common/seaport-vault-safe.mjs";
const require=createRequire(new URL("../../../../../apps/indexer/package.json",import.meta.url)),v=require("viem");
const same=(a,b)=>a.toLowerCase()===b.toLowerCase(),json=x=>JSON.stringify(x,(_,a)=>typeof a==="bigint"?String(a):a);
export async function verifyRawSafeBundles(bundles){
 let executions=0,signatures=0,reverted=0,traceFrames=0;
 for(const bundle of bundles){const s=bundle.safe,m=bundle.deployment,reviews=new Map(s.outerReviews.map(r=>[r.reviewHash,r]));
  assert.equal(s.status,"PASS");assert.equal(s.production,false);assert.equal(s.creatorCreate,"UNAVAILABLE");assert.equal(s.canonicalExecutions.length,s.submissions.length);
  for(const e of s.canonicalExecutions){
   const r=reviews.get(e.reviewHash),p=r.proposal,pre=e.beforeState,post=e.afterState,tx=e.rawTransaction,receipt=e.rawReceipt;
   assert.equal(v.hashTypedData(safe.seaportSafeTypedData(p.safe,p.safeTx)),p.digest);
   assert.equal(await safe.verifySeaportSafeApprovals(p.safe,p.safeTx,pre.owners,r.approvals,v),true);
   assert.deepEqual(pre.owners.map(a=>a.toLowerCase()).sort(),p.owners.map(a=>a.toLowerCase()).sort());
   assert.equal(pre.nonce,p.safeNonce);assert.equal(pre.threshold,2);assert.equal(post.threshold,2);
   assert.equal(same(pre.runtimeHash,safe.seaportSafePins.proxyHash),true);assert.equal(same(post.runtimeHash,safe.seaportSafePins.proxyHash),true);
   assert.equal(same(pre.singleton,safe.seaportSafePins.singleton),true);assert.equal(same(pre.handler,safe.seaportSafePins.handler),true);
   const compiled=safe.compileSeaportSafeCall(m,p.operation,p.fields,v);
   assert.equal(same(compiled.to,p.call.to),true);assert.equal(same(compiled.data,p.call.data),true);assert.equal(compiled.value,p.call.value);
   const decoded=safe.decodeSeaportSafeCall(m,compiled.to,compiled.data,BigInt(compiled.value),v);assert.equal(decoded.operation,p.operation);
   const abi=v.parseAbi(safe.seaportSafeSignatures),outer=v.decodeFunctionData({abi,data:tx.input}),a=outer.args;
   assert.equal(outer.functionName,"execTransaction");assert.equal(v.encodeFunctionData({abi,functionName:"execTransaction",args:a}),tx.input);
   assert.equal(same(a[0],compiled.to),true);assert.equal(a[1],BigInt(compiled.value));assert.equal(a[2],compiled.data);assert.equal(a[3],0);
   for(const i of[4,5,6])assert.equal(a[i],0n);assert.equal(a[7],v.zeroAddress);assert.equal(a[8],v.zeroAddress);assert.equal(a[9],v.concatHex(r.approvals.map(x=>x.signature)));
   assert.equal(same(tx.from,p.gasPayer),true);assert.equal(same(tx.to,p.safe),true);assert.equal(tx.input,r.request.data);assert.equal(tx.value,"0x0");assert.equal(Number(BigInt(tx.chainId)),31337);
   for(const k of["gas","maxFeePerGas","maxPriorityFeePerGas","nonce"])assert.equal(BigInt(tx[k]),BigInt(r.request[k]));
   assert.equal(e.rawBlock.hash,receipt.blockHash);assert.deepEqual(e.rawBlock.transactions,[e.transactionHash]);assert.equal(receipt.transactionHash,e.transactionHash);
   const origin={from:p.gasPayer,to:p.safe,input:tx.input,value:0n},inner={safe:p.safe,target:compiled.to,data:compiled.data,value:BigInt(compiled.value)};
   const success=BigInt(receipt.status)===1n,proof=(success?safe.assertSeaportSafeAdminTrace:safe.assertSeaportSafeAdminRevertTrace)(e.trace,origin,inner);
   assert.equal(json(proof),json(e.traceProof));traceFrames+=proof.frames;
   const events=v.parseEventLogs({abi,strict:true,logs:receipt.logs.filter(l=>same(l.address,p.safe))}).filter(x=>["ExecutionSuccess","ExecutionFailure"].includes(x.eventName));
   if(success){assert.equal(events.length,1);assert.equal(events[0].eventName,"ExecutionSuccess");assert.equal(events[0].args.txHash,p.digest);assert.equal(events[0].args.payment,0n);assert.equal(BigInt(post.nonce),BigInt(pre.nonce)+1n);}
   else{assert.equal(events.length,0);assert.equal(post.nonce,pre.nonce);const error=v.decodeErrorResult({abi:v.parseAbi(["error Error(string)"]),data:e.trace.output});assert.equal(error.args[0],"GS013");reverted++;}
   assert.equal(await safe.verifySeaportSafeApprovals(p.safe,{...p.safeTx,nonce:String(BigInt(p.safeTx.nonce)+1n)},pre.owners,r.approvals,v),false,"Changing nonce must invalidate the archived real owner signatures");
   const tampered=structuredClone(e.trace);const delegate=tampered.calls.find(n=>n.type==="DELEGATECALL"&&same(n.to,safe.seaportSafePins.singleton));assert.ok(delegate);delegate.calls??=[];delegate.calls.push({type:"CALL",from:p.safe,to:"0x00000000000000000000000000000000feed0000",input:"0x095ea7b3",value:"0x0"});
   assert.throws(()=>(success?safe.assertSeaportSafeAdminTrace:safe.assertSeaportSafeAdminRevertTrace)(tampered,origin,inner),"An added Safe mutable CALL must be rejected");
   executions++;signatures+=r.approvals.length;
  }
 }
 return{status:"PASS",bundles:bundles.length,executions,verifiedSignatureUses:signatures,reverted,traceFrames,tamperRejections:executions*2,production:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const directory=fileURLToPath(new URL(".",import.meta.url)),manifest=JSON.parse(readFileSync(join(directory,"manifest.json"),"utf8")),bundles=[];
 for(const artifact of manifest.artifacts){const read=name=>{const item=artifact.members.find(x=>x.originalMember===name),bytes=readFileSync(new URL("../../../../../"+item.path,import.meta.url));assert.equal(createHash("sha256").update(bytes).digest("hex"),item.storedSha256);const raw=gunzipSync(bytes);assert.equal(createHash("sha256").update(raw).digest("hex"),item.rawSha256);return JSON.parse(raw);};bundles.push({safe:read("seaport-safe-admin-evidence.json"),deployment:read("chain/seaport-acquisition-deployment.json")});}
 console.log(JSON.stringify(await verifyRawSafeBundles(bundles)));
}
