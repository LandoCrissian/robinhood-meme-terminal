import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {boundedCollectionReads,bindReferenceConstructorModules,classifyDirectCollectionTransfer,selectorNamesFromSources,collectionPolicyProbePins,probeCollectionPolicy,reconstructPartialCollectionProvider} from "./probe-collection-policy.mjs";
import {createCollectionPolicyReview} from "./collection-policy-review.mjs";

const root=new URL("../../docs/evidence/rmt-task086/collection/",import.meta.url),bytes=name=>readFileSync(new URL(name,root)),parse=name=>JSON.parse(bytes(name));
const sha=x=>createHash("sha256").update(x).digest("hex"),same=(a,b)=>a.toLowerCase()===b.toLowerCase();
const capture=(prefix="")=>{const compressed=bytes(prefix+"raw-public-responses.json.gz"),raw=gunzipSync(compressed,{maxOutputLength:8*1024*1024});return{compressed,raw,rows:JSON.parse(raw),report:parse(prefix+"collection-policy-observation.json"),manifest:parse(prefix+"probe-manifest.json")};};
const final=capture(),p=collectionPolicyProbePins;

test("bounded independent reads retain order and fully drain failures",async()=>{
 let active=0,maxActive=0,finished=0;
 const result=await boundedCollectionReads([30,5,1,5],2,async(ms,index)=>{active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,ms));active--;finished++;return index;});
 assert.deepEqual(result,[0,1,2,3]);assert.equal(maxActive,2);assert.equal(finished,4);
 finished=0;await assert.rejects(boundedCollectionReads([1,20,1],2,async(ms,index)=>{await new Promise(r=>setTimeout(r,ms));finished++;if(index===0)throw Error("EXPECTED_READ_FAILURE");}),/EXPECTED_READ_FAILURE/);
 assert.equal(finished,3);await new Promise(r=>setTimeout(r,25));assert.equal(finished,3);
 await assert.rejects(boundedCollectionReads([1],9,async()=>{}),/READ_CONCURRENCY_BOUND/);
});

test("missing seller authority and approved validator restriction stay distinct",()=>{
 const errors={"0x59c896be":"TransferCallerNotOwnerNorApproved","0xe1f1d02e":"CreatorTokenTransferValidator__CallerOrFromMustBeWhitelisted"};
 const unapproved=classifyDirectCollectionTransfer({approved:false,success:false,revertData:"0x59c896be",errors});
 const restricted=classifyDirectCollectionTransfer({approved:true,success:false,revertData:"0xe1f1d02e",errors});
 assert.equal(unapproved.status,"SELLER_AUTHORIZATION_MISSING");assert.equal(unapproved.errorName,errors["0x59c896be"]);
 assert.equal(restricted.status,"TRANSFER_REJECTED_REQUIRES_POLICY_REVIEW");assert.equal(restricted.errorName,errors["0xe1f1d02e"]);
 assert.equal(classifyDirectCollectionTransfer({approved:true,success:true,revertData:null}).status,"READ_ONLY_CALL_SUCCEEDED_NOT_PURCHASE_ADMISSION");
 assert.throws(()=>classifyDirectCollectionTransfer({approved:null,success:false}),/TRANSFER_EVIDENCE_UNAVAILABLE/);
});

test("reference constructor module binds reject runtime drift without claiming deployment closure",()=>{
 const ref=JSON.parse(final.rows.find(r=>r.url.includes("/contract/1/"+p.validator)&&r.httpStatus===200).rawUtf8);
 const code=JSON.parse(final.rows.find(r=>r.url.includes("rpc.mainnet.chain.robinhood.com")&&r.request?.method==="eth_getCode"&&same(r.request.params[0],p.validator)).rawUtf8).result;
 const result=bindReferenceConstructorModules(ref,code);assert.equal(result.actualDeploymentConstructorVerified,false);assert.equal(result.overallImmutableBindingsVerified,false);
 assert.deepEqual(Object.keys(result.modules),["eoaRegistry","managementModule","safeDelegateModule"]);
 for(const[role,value]of Object.entries(result.modules)){assert.equal(value.address,p[role]);assert.equal(value.currentCodeBindingVerified,true);}
 const changed="0x"+(code.slice(2,4)==="00"?"01":"00")+code.slice(4);
 assert.throws(()=>bindReferenceConstructorModules(ref,changed),/VALIDATOR_REFERENCE_EXECUTABLE_MISMATCH/);
 const selectors=selectorNamesFromSources(ref.sources);assert.equal(selectors["0xe1f1d02e"],"CreatorTokenTransferValidator__CallerOrFromMustBeWhitelisted");
});

function replay({malformedId=false,unavailablePocket=false}={}){
 const byKey=new Map();for(const row of final.rows){const key=JSON.stringify([row.url,row.method,row.request?.method,row.request?.params]);const list=byKey.get(key)??[];list.push(row);byKey.set(key,list);}
 return async(url,options)=>{
  assert.equal(options.credentials,"omit");assert.equal(options.redirect,"error");assert.ok(!options.headers.authorization);
  const request=options.body?JSON.parse(options.body):null,key=JSON.stringify([url,options.method,request?.method,request?.params]);
  const candidates=byKey.get(key);assert.ok(candidates?.length,"only already archived fixed public reads");
  const row=candidates.find(r=>!request||JSON.parse(r.rawUtf8??"{}").result!==null)??candidates[0];let body=row.rawUtf8;
  if(request){assert.ok(["eth_chainId","eth_getBlockByNumber","eth_getCode","eth_call"].includes(request.method));if(unavailablePocket&&url.includes("pocket"))return new Response("rate limited",{status:429});const response=JSON.parse(body);response.id=malformedId&&url.includes("rpc.mainnet")?request.id+1:request.id;body=JSON.stringify(response);}
  return new Response(body,{status:row.httpStatus,headers:{"content-type":row.contentType??"application/json"}});
 };
}

test("synthetic archive replay corroborates only when final canonical recheck exists and remains NO_GO",async()=>{
 // Reuse the initial archived header for both rechecks ONLY in this synthetic
 // regression. The real archived Pocket final recheck remains null/unavailable.
 const {report,raw}=await probeCollectionPolicy({fetchImpl:replay(),nowMs:Date.parse(final.report.observedAt)});
 assert.equal(report.corroborated,true);assert.equal(report.roles.length,8);assert.deepEqual(report.providers.official.state,report.providers.pocket.state);
 assert.equal(report.state.operatorApprovals.seaport,false);assert.equal(report.state.operatorApprovals.conduit,true);assert.equal(report.state.sellerWhitelisted,false);
 assert.equal(report.transferChecks.find(x=>x.kind==="directTransferFrom"&&same(x.operator,p.seaport)).status,"SELLER_AUTHORIZATION_MISSING");
 assert.equal(report.compatibility.immutableReceiverBanEstablished,false);assert.equal(report.order.fullSignedPayloadAvailable,false);assert.equal(report.order.status,"CURRENT_ORDER_UNAVAILABLE");
 const persisted=JSON.parse(JSON.stringify(report,(_,value)=>typeof value==="bigint"?String(value):value));
 const review=createCollectionPolicyReview(persisted,{nowMs:Number(report.anchor.timestamp)*1000+30000});
 assert.equal(review.status,"REVIEW_RECORDED",JSON.stringify(review));assert.equal(review.productionStatus,"NO_GO");assert.equal(review.ownerApprovalReady,false);assert.ok(review.blockers.includes("SOURCE_OR_IMMUTABLE_BINDINGS_UNRESOLVED"));
 assert.ok(report.readBudget.rpcReads<=160);assert.equal(raw.filter(r=>r.method==="GET").length,16);assert.equal(report.broadcast,false);
});

test("RPC identity or HTTP failure cannot produce collection qualification",async()=>{
 for(const options of[{malformedId:true},{unavailablePocket:true}]){
  const {report}=await probeCollectionPolicy({fetchImpl:replay(options)});
  assert.equal(report.corroborated,false);assert.equal(report.anchor,undefined);assert.equal(report.productionApproved,false);assert.equal(report.productionCatalogEmpty,true);
  assert.equal(report.observationFailure,options.malformedId?"RPC_RESPONSE_IDENTITY":"RPC_TRANSPORT_UNAVAILABLE");
 }
});

test("retained attempts bind original archive/report bytes and fixed read-only scope",()=>{
 const rpcUrls=new Set(["https://rpc.mainnet.chain.robinhood.com","https://robinhood.api.pocket.network"]);
 for(const prefix of["","development-first/","development-sequential-archive-failure/","development-concurrent-rate-limit/"]){
  const {compressed,raw,rows,report,manifest}=capture(prefix);
  assert.equal(sha(raw),manifest.rawSha256);assert.equal(raw.length,manifest.rawBytes);assert.equal(rows.length,manifest.responses);assert.equal(sha(bytes(prefix+"collection-policy-observation.json")),manifest.reportSha256);
  assert.ok(compressed.length<2*1024*1024);assert.ok(raw.length<8*1024*1024);assert.ok(rows.length<=176);assert.equal(report.productionApproved,false);assert.equal(report.productionCatalogEmpty,true);assert.equal(report.order.fullSignedPayloadAvailable,false);assert.equal(report.exploration.candidates,1);
  for(const row of rows){
   assert.ok(["GET","POST"].includes(row.method));assert.equal(row.apiCredentialUsed,false);assert.equal(row.credentials,"omit");assert.equal(row.redirect,"error");assert.equal(row.authorization,undefined);assert.equal(row.headers,undefined);
   if(row.rawUtf8!==undefined){assert.equal(sha(row.rawUtf8),row.sha256);assert.equal(Buffer.byteLength(row.rawUtf8),row.bytes);assert.ok(row.bytes<=(row.method==="POST"?256*1024:2*1024*1024));}
   if(row.method==="POST"){assert.ok(rpcUrls.has(row.url));assert.ok(["eth_chainId","eth_getBlockByNumber","eth_getCode","eth_call"].includes(row.request.method));assert.ok(JSON.stringify(row.request.params).length<=8192);assert.equal(row.request.params.some(x=>x==="pending"),false);}
   else assert.match(row.url,/^https:\/\/(sourcify\.dev\/server\/v2\/contract\/(1|4663)\/0x[0-9a-f]{40}\?fields=all|api\.opensea\.io\/api\/v2\/listings\/collection\/lammbs-59693791\/best\?limit=1|opensea\.io\/collection\/lammbs-59693791)$/i);
  }
 }
 assert.equal(final.manifest.producerSha256,sha(bytes("capture-producer.mjs")));
 assert.equal(final.manifest.offlineReprocessorSha256,sha(readFileSync(new URL("./probe-collection-policy.mjs",import.meta.url))));
 const initial=bytes("collection-policy-observation.initial.json");assert.equal(sha(initial),final.manifest.initialReportSha256);
 assert.deepEqual(reconstructPartialCollectionProvider(JSON.parse(initial),final.rows),final.report);
 assert.equal(final.report.providers.pocket.canonicalRechecked,false);assert.equal(final.report.offlineEvidenceReconstruction.matchedCodeAndCallResponses,37);
 const drift=structuredClone(final.rows),changed=drift.find(r=>r.url.includes("pocket")&&r.request?.method==="eth_getCode");changed.rawUtf8=JSON.stringify({...JSON.parse(changed.rawUtf8),result:"0x00"});
 assert.throws(()=>reconstructPartialCollectionProvider(JSON.parse(initial),drift),/PARTIAL_PROVIDER_STATE_DISAGREEMENT/);
 assert.equal(final.report.corroborated,false);assert.equal(final.report.observationFailure,"RPC_RESULT_UNAVAILABLE");assert.equal(final.report.anchor,undefined);
 const recheck=final.rows.filter(r=>r.url.includes("pocket")&&r.request?.method==="eth_getBlockByNumber"&&r.request.params[0]!=="latest");assert.equal(recheck.length,2);assert.equal(JSON.parse(recheck.at(-1).rawUtf8).result,null);
 assert.equal(createCollectionPolicyReview(final.report,{nowMs:Date.parse(final.report.finishedAt)}).productionStatus,"NO_GO");
});

test("source/authority matrix and notices preserve reference limits and unheadered files",()=>{
 const matrix=parse("source-authority-matrix.json");assert.equal(matrix.productionStatus,"NO_GO");assert.equal(matrix.corroborated,false);assert.equal(matrix.roles.length,8);assert.equal(matrix.authorityClosure,"UNRESOLVED");
 for(const source of matrix.publicSources){const row=final.rows.find(r=>r.url===source.url&&r.sha256===source.responseSha256);assert.ok(row);const contract=JSON.parse(row.rawUtf8);for(const file of source.files){const original=contract.sources[file.path]?.content;assert.ok(original);assert.equal(sha(original),file.sha256);assert.equal(file.spdx,original.match(/SPDX-License-Identifier:([^\r\n]+)/)?.[1]?.trim()??null);}}
 assert.ok(matrix.publicSources.some(x=>x.files.some(f=>f.spdx===null)));assert.equal(matrix.validatorModuleBinding.actualDeploymentConstructorVerified,false);assert.equal(matrix.validatorModuleBinding.overallImmutableBindingsVerified,false);
 const notices=bytes("UPSTREAM_NOTICES.md").toString("utf8");assert.match(notices,/Task085/);assert.match(notices,/unheadered|omit SPDX/);assert.match(notices,/Permission is hereby granted/);
});

test("unchanged Gitleaks scans bind every original envelope and unescaped body",()=>{
 const config=readFileSync(new URL("../../.gitleaks.toml",import.meta.url));
 for(const prefix of["","development-first/","development-sequential-archive-failure/","development-concurrent-rate-limit/"]){
  const{raw,rows,manifest}=capture(prefix),bodies=Buffer.from(rows.filter(r=>r.rawUtf8!==undefined).map(r=>r.url+"\n"+r.rawUtf8).join("\n\n"));
  assert.equal(manifest.scanner.name,"Gitleaks");assert.equal(manifest.scanner.version,"8.30.1");assert.equal(manifest.scanner.configurationSha256,sha(config));assert.equal(manifest.scanner.suppressionsAdded,false);
  assert.equal(manifest.scanner.httpBodiesSha256,sha(bodies));assert.equal(manifest.scanner.httpBodiesBytes,bodies.length);assert.equal(manifest.scanner.envelopeSha256,sha(raw));
  for(const scope of["envelope","httpBodies"]){const report=parse(prefix+(scope==="envelope"?"raw-gitleaks-report.json":"raw-http-body-gitleaks-report.json"));assert.equal(manifest.scanner[scope+"Findings"],report.length);assert.equal(manifest.scanner[scope+"ExitCode"],report.length?1:0);}
 }
});
