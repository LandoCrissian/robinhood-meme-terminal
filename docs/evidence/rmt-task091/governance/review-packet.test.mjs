import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {validateReviewPacket,publicationDigest,ACTION,DIGEST,ZERO,ZERO_ADDRESS} from "./review-packet.mjs";
import {verifyCaptureEvidence,verifyAuthorityEvidence} from "./verify-evidence.mjs";
const load=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const evidence=()=>JSON.parse(gunzipSync(readFileSync(new URL("current/capture.json.gz",import.meta.url))));
const inputs={protocol:load("../../mobile-signing/protocol-mainnet.json"),profile:load("../../fixed-supply-security/4663-profile.json"),scheduled:load("../../mobile-signing/factory-publication-scheduled.json")};
const packet=()=>load("current/unsigned-execute-review.json");
const authority=()=>JSON.parse(gunzipSync(readFileSync(new URL("current/authority.json.gz",import.meta.url))));
const authorityInputs={treasury:load("../../mobile-signing/treasuries-mainnet.json"),safeRegistry:load("../../rmt-task044/safe-infrastructure-4663.json").registry.contracts["1.4.1"]};
const require=createRequire(new URL("../../../../apps/launch-website/package.json",import.meta.url));
const {keccak256}=require("viem");
test("replay 206 actual bounded public reads, all14pins and canonical constructor/schedule witnesses",()=>{
 const r=evidence();assert.equal(verifyCaptureEvidence(r,inputs).status,"RAW_EVIDENCE_REPLAYED");
});
test("admit exact original action for review at captured block; never authorize signing or broadcast",()=>{
 const r=evidence();assert.deepEqual(validateReviewPacket(packet(),r,r.anchor.timestamp),{status:"VALID_REVIEW_ONLY_REQUIRES_FRESH_WALLET_OWNER_APPROVAL",signingAuthorized:false,broadcastAuthorized:false});
 assert.equal(publicationDigest(),DIGEST);
});
test("replay114 exact authority reads: unpublished V3 template and both2of3Safes, no modules/guard, pinned handler",()=>{
 assert.equal(verifyAuthorityEvidence(authority(),authorityInputs).status,"RAW_AUTHORITY_EVIDENCE_REPLAYED");
 const r=authority();r.providers.pocket.safes[0].state.getThreshold="1";assert.throws(()=>verifyAuthorityEvidence(r,authorityInputs));
});
test("reject altered action typed domain value and calldata",()=>{
 for(const change of [p=>p.action.nonce="1",p=>p.action.factory=ZERO_ADDRESS,p=>p.action.deadline="1795722607",p=>p.action.runtimeHash=ZERO,p=>p.action.kind=1,
  p=>p.chainId=31337,p=>p.to=ZERO_ADDRESS,p=>p.valueWei="1",p=>p.data=p.data.slice(0,-2)+"00",p=>p.request.value="0x1",p=>p.request.authorizationList=[]]){
  const p=packet(),r=evidence();change(p);assert.throws(()=>validateReviewPacket(p,r,r.anchor.timestamp));
 }
});
test("reject current action change, rotation, duplicate publication, suspended directory and pending sender nonce",()=>{
 for(const change of [r=>r.state.pending[0]=ZERO,r=>r.state.nonce="1",r=>r.state.signerSetEpoch="2",r=>r.state.latestVersion="1",r=>r.state.suspended=true,
  r=>r.state.factories=[ACTION.factory,ACTION.runtimeHash],r=>r.state.pendingRotation=[DIGEST,"1","2"],r=>r.account.pendingNonce="495",r=>r.account.confirmedNonce="493",
  r=>r.state.factoryEngineVersion="2",r=>r.state.actionDigest=ZERO,r=>r.allRuntimePinsMatch=false,r=>r.canonicalAnchorRechecked=false]){
  const r=evidence();change(r);assert.throws(()=>validateReviewPacket(packet(),r,r.anchor.timestamp));
 }
});
test("enforce actual notice and inclusive expiry, independent of fake accelerated fork clock",()=>{
 const r=evidence(),p=packet();r.anchor.timestamp="1795131148";assert.doesNotThrow(()=>validateReviewPacket(p,r,1795131148n));
 assert.throws(()=>validateReviewPacket(p,r,1795131147n),/NOTICE_OR_EXPIRY/);
 r.anchor.timestamp="1795722606";assert.doesNotThrow(()=>validateReviewPacket(p,r,1795722606n));
 assert.throws(()=>validateReviewPacket(p,r,1795722607n),/NOTICE_OR_EXPIRY/);
});
test("saved costs/nonce expire after180seconds and cannot be treated as current wallet approval",()=>{
 const r=evidence();assert.doesNotThrow(()=>validateReviewPacket(packet(),r,BigInt(r.anchor.timestamp)+180n));
 assert.throws(()=>validateReviewPacket(packet(),r,BigInt(r.anchor.timestamp)+181n),/STALE_REVIEW_RECAPTURE_REQUIRED/);
 const p=packet();p.signingAuthorized=true;assert.throws(()=>validateReviewPacket(p,r,r.anchor.timestamp));
});
test("refuse underfunded caller and incoherent cost maximum",()=>{
 const r=evidence();r.account.balanceWei="0";assert.throws(()=>validateReviewPacket(packet(),r,r.anchor.timestamp));
 const p=packet();p.cost.maximumWei="1";const good=evidence();assert.throws(()=>validateReviewPacket(p,good,good.anchor.timestamp));
});
test("raw replay rejects reorg, changed deployed runtime, forged raw digest, prohibited RPC and changed simulation",()=>{
 const mutate=(selector,result)=>{const r=evidence(),row=r.requests.find(selector),body=JSON.parse(row.rawUtf8);body.result=result;row.rawUtf8=JSON.stringify(body);row.responseSha256=createHash("sha256").update(row.rawUtf8).digest("hex");return r;};
 const reorg=mutate(x=>x.request.method==="eth_getBlockByNumber"&&x.request.params[0]===evidence().tag,{number:evidence().tag,hash:ZERO,timestamp:"0x6b00ae54"});
 assert.throws(()=>verifyCaptureEvidence(reorg,inputs));
 const code=mutate(x=>x.request.method==="eth_getCode"&&x.request.params[0]===ACTION.factory,"0x6000");assert.throws(()=>verifyCaptureEvidence(code,inputs));
 const digest=evidence();digest.requests[0].responseSha256="0".repeat(64);assert.throws(()=>verifyCaptureEvidence(digest,inputs),/RAW_RESPONSE_DIGEST/);
 const prohibited=evidence();prohibited.requests[0].request.method="eth_sendRawTransaction";assert.throws(()=>verifyCaptureEvidence(prohibited,inputs),/PROHIBITED_RPC_METHOD/);
 const changed=mutate(x=>x.request.method==="eth_call"&&x.request.params[0].data===packet().data,"0x01");assert.throws(()=>verifyCaptureEvidence(changed,inputs));
});
test("four exact source-verification forms reconstruct original production constructor bytes and current runtime targets offline",()=>{
 const manifest=load("source-publication/manifest.json"),original=load("../../mobile-signing/protocol-owner-plan.json");
 const compilation=JSON.parse(gunzipSync(readFileSync(new URL("../../rmt-task090/migration/canonical-compilation.json.gz",import.meta.url))));
 const expected=[...original.constructors,...original.bootstrapChildren];
 const sha=b=>createHash("sha256").update(b).digest("hex");
 function verify(p){
  const pin=expected.find(e=>e.contract===p.id);assert.ok(pin);assert.equal(p.address.toLowerCase(),pin.predictedAddress.toLowerCase());
  assert.equal(p.initcodeHash,pin.initcodeHash);assert.equal(p.runtimeHash,pin.runtimeHash);
  assert.equal(p.transport.url,"https://robinhoodchain.blockscout.com/api?module=contract&action=verifysourcecode");assert.equal(p.transport.method,"POST");
  assert.deepEqual(Object.keys(p.fields).sort(),["contractaddress","contractname","codeformat","compilerversion","sourceCode","constructorArguments","autodetectConstructorArguments","licenseType"].sort());
  assert.equal(p.fields.contractaddress,p.address);assert.equal(p.fields.contractname,p.fullyQualifiedName);
  assert.equal(p.fields.codeformat,"solidity-standard-json-input");assert.equal(p.fields.compilerversion,"v0.8.26+commit.8a97fa7a");
  assert.equal(p.fields.autodetectConstructorArguments,"false");assert.equal(p.fields.licenseType,"3");
  assert.equal(sha(p.fields.sourceCode),inputs.profile.inputSha256);assert.equal(Object.keys(JSON.parse(p.fields.sourceCode).sources).length,66);
  assert.equal(p.constructorArguments,"0x"+p.fields.constructorArguments);
  assert.equal(keccak256(compilation.artifacts[p.id].bytecode+p.fields.constructorArguments),pin.initcodeHash);
  assert.ok(evidence().expectedPins.some(row=>row.address===p.address.toLowerCase()&&row.runtimeHash===p.runtimeHash));
  assert.equal(p.submitted,false);assert.equal(p.createsContract,false);assert.equal(p.createsToken,false);
 }
 assert.equal(manifest.requests.length,4);assert.equal(manifest.networkRequests,0);assert.equal(manifest.submitted,false);
 for(const spec of manifest.requests){const p=JSON.parse(gunzipSync(readFileSync(new URL("source-publication/"+spec.id+".request.json.gz",import.meta.url))));verify(p);
  for(const change of [q=>q.fields.constructorArguments=q.fields.constructorArguments.slice(0,-2)+"ff",q=>q.fields.sourceCode+="\n",q=>q.fields.contractaddress=ZERO_ADDRESS,q=>q.fields.apikey="unapproved",q=>q.runtimeHash=ZERO]){const bad=structuredClone(p);change(bad);assert.throws(()=>verify(bad));}
 }
});
