import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {test} from "node:test";
import {gunzipSync} from "node:zlib";
import {createSeaportVerifier} from "../../../../../packages/launchpad-common/seaport-order-verifier.mjs";
import {seaportVaultSignatures,seaportVaultSeaportSignatures,seaportVaultNftSignatures} from "../../../../../packages/launchpad-common/seaport-vault-runtime.mjs";
import {assertSeaportVaultTrace} from "../../../../../packages/launchpad-common/seaport-vault-proof.mjs";
import {loadSeaportArtifacts,materialize,seaportImmutableValues} from "../../../../../scripts/seaport-verification/provenance-rebuild.mjs";

// This audits retained observations; it does not replay a chain or assert that an
// observation before evm_revert is canonical at the final fixture checkpoint.
const root=new URL("../../../../../",import.meta.url), require=createRequire(new URL("apps/indexer/package.json",root));
const v=require("viem"), verifier=createSeaportVerifier(v), abi=v.parseAbi(seaportVaultSignatures), seaAbi=v.parseAbi(seaportVaultSeaportSignatures), nftAbi=v.parseAbi(seaportVaultNftSignatures);
const sha=b=>createHash("sha256").update(b).digest("hex"), same=(a,b)=>assert.equal(a.toLowerCase(),b.toLowerCase());
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==="object"?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,y])=>[k,canonical(y)])):x;
const digest=x=>v.keccak256(v.stringToHex(JSON.stringify(canonical(x))));
const manifest=JSON.parse(readFileSync(new URL("manifest.json",import.meta.url)));
function raw(path){return gunzipSync(readFileSync(new URL(path,import.meta.url)),{maxOutputLength:4*1024*1024});}
function reports(engine){const get=path=>JSON.parse(raw(`${engine}/${path}.gz`));return {browser:get("seaport-browser-evidence.json"),chain:get("chain/seaport-acquisition-fixture-evidence.json"),deployment:get("chain/seaport-acquisition-deployment.json"),indexer:get("indexer-acceptance.json"),worker:get("worker-diagnostics.json")};}
function checkStored(file,stored){assert.equal(sha(stored),file.storedSha256);const bytes=file.path.endsWith(".gz")?gunzipSync(stored,{maxOutputLength:4*1024*1024}):stored;assert.equal(bytes.length,file.uncompressedBytes);assert.equal(sha(bytes),file.sha256);return bytes;}
function checkReview(r,m){
  const {reviewHash,...body}=r;assert.equal(digest(body),reviewHash);assert.equal(r.chainId,31337);assert.equal(r.scope,"synthetic-local");assert.equal(r.productionExecution,false);
  same(r.vault,m.vault);same(r.account,m.creator);same(r.runtimeHash,m.vaultRuntimeHash);assert.deepEqual(Object.keys(r.request).sort(),["type","chainId","from","to","data","value","nonce","gas","maxFeePerGas","maxPriorityFeePerGas"].sort());
  assert.equal(r.request.type,"0x2");assert.equal(r.request.chainId,"0x7a69");assert.equal(r.request.value,"0x0");same(r.request.from,r.account);same(r.request.to,r.vault);
  assert.equal(String(BigInt(r.request.gas)*BigInt(r.request.maxFeePerGas)),r.maximumNetworkFeeWei);
  const decoded=v.decodeFunctionData({abi,data:r.request.data});assert.equal(decoded.functionName,{buy:"purchase",configure:"configurePolicy",disable:"disablePurchases"}[r.operation]);
  assert.equal(v.encodeFunctionData({abi,functionName:decoded.functionName,args:decoded.args}),r.request.data);
  if(r.operation==="configure"){
    const [policy,enabled]=decoded.args;for(const key of ["currency","perNftCap","totalBudget","periodBudget","cooldownSeconds"])same(String(policy[key]),String(r.fields[key]));assert.equal(enabled,r.fields.enabled);assert.equal(r.listing,null);
  }else if(r.operation==="disable"){assert.equal(r.listing,null);}
  else{
    const order=verifier.normalizeSeaportOrder(r.fields.order), d=verifier.seaportOrderDigest(r.fields.order),[advanced,request]=decoded.args;
    assert.equal(v.encodeAbiParameters([{type:"bytes32"}],[request.signedOrderHash]),v.encodeAbiParameters([{type:"bytes32"}],[d.orderHash]));
    assert.equal(request.counter,BigInt(order.components.counter));assert.equal(String(request.policyEpoch),r.policyEpoch);assert.equal(String(request.controllerEpoch),r.controllerEpoch);
    assert.equal(advanced.signature,r.fields.order.signature);assert.equal(advanced.numerator,1n);assert.equal(advanced.denominator,1n);assert.equal(advanced.extraData,"0x");assert.deepEqual(advanced.parameters,order.parameters);
    const offer=order.parameters.offer[0],payments=order.parameters.consideration,l=r.listing;assert.equal(l.orderHash,d.orderHash);same(l.collection,offer.token);assert.equal(l.tokenId,String(offer.identifierOrCriteria));assert.equal(l.quantity,String(offer.startAmount));same(l.currency,payments[0].token);same(l.custody,m.vault);
    assert.equal(l.total,String(payments.reduce((sum,p)=>sum+p.startAmount,0n)));assert.deepEqual(l.consideration,payments.map(p=>({recipient:p.recipient,amount:String(p.startAmount)})));
  }
}
function checkSettlement(s,r,submitted,m){
  same(s.transactionHash,submitted.transactionHash);same(s.blockHash,submitted.blockHash);assert.equal(s.blockNumber,submitted.blockNumber);same(s.input,r.request.data);assert.equal(s.nonce,String(BigInt(r.request.nonce)));same(s.account,r.account);same(s.vault,r.vault);same(s.projectToken,m.projectToken);
  for(const key of ["orderHash","collection","tokenId","quantity","currency","total","custody"])same(String(s[key]),String(r.listing[key]));
  assert.deepEqual(s.payments,r.listing.consideration);assert.equal(s.proof.evidence,"canonical-receipt-and-exact-local-call-trace");assert.ok(s.proof.frames>0);
}
function traceExpected(c,m){
  const receipt=c.settled.receipt,decoded=v.decodeFunctionData({abi,data:receipt.input}),[advanced]=decoded.args,offer=advanced.parameters.offer[0],payments=advanced.parameters.consideration;
  const native=payments[0].itemType===0,total=payments.reduce((sum,p)=>sum+p.startAmount,0n),multi=offer.itemType===3;
  return {vault:m.vault,seaport:m.seaport,collection:offer.token,purchaseInput:receipt.input,fulfillInput:v.encodeFunctionData({abi:seaAbi,functionName:"fulfillAdvancedOrder",args:[advanced,[],v.zeroHash,m.vault]}),nftTransferInput:v.encodeFunctionData({abi:nftAbi,functionName:multi?"safeTransferFrom":"transferFrom",args:multi?[advanced.parameters.offerer,m.vault,offer.identifierOrCriteria,offer.startAmount,"0x"]:[advanced.parameters.offerer,m.vault,offer.identifierOrCriteria]}),native,total,currency:payments[0].token,payments:payments.map(p=>({recipient:p.recipient,amount:p.startAmount})),tokenTransferInputs:payments.map(p=>v.encodeFunctionData({abi:v.parseAbi(["function transferFrom(address,address,uint256)"]),functionName:"transferFrom",args:[m.vault,p.recipient,p.startAmount]})),admittedSafeDelegates:[{proxy:m.safeSeller.address,singleton:m.safeSeller.singleton}]};
}
function checkConnected(x){
  const {browser:b,chain:c,deployment:m,indexer:i,worker:w}=x;assert.equal(b.status,"PASS");assert.equal(c.status,"PASS");assert.equal(i.status,"PASS");assert.equal(i.production,false);assert.deepEqual(c.bindings,m);assert.equal(c.checks.actualFixed1BCore,true);assert.equal(c.core.syntheticCoreBindingStub,false);assert.equal(c.checks.actualSourceDerivedSeaport,true);assert.equal(c.checks.actualPinned4663Seaport,false);assert.equal(c.core.core.fixedSupplyWei,"1000000000000000000000000000");
  assert.equal(b.reviews.length,8);assert.equal(b.submissions.length,7);assert.equal(b.signingInvocations,7);assert.equal(new Set(b.submissions.map(s=>s.transactionHash)).size,7);assert.equal(new Set(b.submissions.map(s=>s.reviewHash)).size,7);
  assert.deepEqual(b.pageErrors,[]);assert.deepEqual(b.externalRequests,[]);assert.ok(Object.values(b.checks).every(x=>x===true));assert.ok(b.walletMethods.every(x=>["eth_chainId","eth_accounts","eth_requestAccounts","eth_sendTransaction"].includes(x)));
  for(const r of b.reviews)checkReview(r,m);
  for(const s of b.submissions){const r=b.reviews.find(r=>r.reviewHash===s.reviewHash);assert.ok(r);assert.deepEqual(s.request,r.request);assert.ok(BigInt(s.gasUsed)<=BigInt(s.request.gas));const recovered=b.recoveries.filter(x=>x.transactionHash===s.transactionHash&&x.status!=='pending');assert.ok(recovered.length);for(const recovery of recovered){assert.equal(recovery.reviewHash,r.reviewHash);assert.equal(recovery.status,s.status==='success'?'confirmed':'reverted');if(recovery.status==='confirmed'){same(recovery.canonical.blockHash,s.blockHash);assert.equal(recovery.canonical.blockNumber,s.blockNumber);assert.equal(recovery.indexed,r.operation==='buy');if(recovery.indexed)checkSettlement(recovery.settlement,r,s,m);}}}
  assert.deepEqual(b.recoveries[1].settlement,b.recoveries[2].settlement); // new DB connection + indexer restart
  assert.equal(b.rejections[0].code,4001);assert.equal(b.rejections[0].additionalSignatures,0);assert.equal(b.rejections[0].additionalSubmissions,0);assert.equal(b.formEdits[0].pendingJournalUnchanged,true);assert.equal(b.formEdits[0].additionalSubmissions,0);
  const cancelled=b.submissions.find(s=>s.status==='reverted');assert.ok(cancelled?.cancellationHash);const cancellation=c.receipts.find(r=>r.transactionHash===cancelled.cancellationHash);assert.equal(cancellation.status,'success');assert.ok(BigInt(cancellation.blockNumber)<BigInt(cancelled.blockNumber));same(cancellation.to,m.seaport);
  const pending=b.recoveries[6],confirmed=b.recoveries[7];assert.equal(pending.status,'pending');same(pending.transactionHash,confirmed.transactionHash);assert.equal(pending.reviewHash,confirmed.reviewHash);assert.ok(w.deniedTraceTransactions.includes(pending.transactionHash));
  assert.equal(b.recoveries[8].status,'confirmed');assert.equal(b.recoveries[9].status,'pending');assert.equal(b.submissions.at(-1).request.data,'0x5b229bf9'); // disable is orphaned with token buy, no replacement
  assert.ok(BigInt(w.checkpointHeight)<BigInt(b.submissions.at(-1).blockNumber));assert.equal(w.status,'ready');assert.equal(w.running,false);assert.equal(w.lastFailure,null);assert.equal(w.checkpointHeight,w.expectedCheckpoint);assert.equal(w.checkpointHeight,w.targetHeight);assert.equal(i.singleWriterDenied,true);
  for(const layout of b.layouts){assert.equal(layout.noOverflow,true);assert.equal(layout.physicalIPhone,false);}
  return x;
}

test('selected GitHub artifact bytes, screenshot signatures and complete raw finding accounting',()=>{
  assert.equal(manifest.sourceCommit,'f5a9f40ce2ffb292c8cd12f985158d00416fd3fd');assert.equal(manifest.currentLiveListingVerified,false);assert.equal(manifest.productionStatus,'NO_GO');assert.equal(manifest.scanner.unclassified,0);
  const reportBytes=raw(manifest.scanner.report);assert.equal(sha(reportBytes),manifest.scanner.uncompressedReportSha256);const findings=JSON.parse(reportBytes);assert.equal(findings.length,76);assert.equal(manifest.classifications.length,76);
  for(const e of manifest.engines){assert.equal(e.reportedDigestMatches,true);assert.equal(e.artifactZipSha256,e.githubReportedZipSha256);assert.equal(e.runId,'44587226489');assert.equal(e.files.length,9);for(const f of e.files){const bytes=checkStored(f,readFileSync(new URL(f.path,import.meta.url)));if(f.path.endsWith('.png')){assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.ok(bytes.readUInt32BE(16)>300);assert.ok(bytes.readUInt32BE(20)>300);}}}
  for(const f of findings){const path=f.File.replaceAll('\\','/').split('/connected-f5/').at(-1),matches=manifest.classifications.filter(c=>c.file===path&&c.line===f.StartLine&&c.ruleId===f.RuleID);assert.equal(matches.length,1);const c=matches[0],line=raw(path+'.gz').toString('utf8').split(/\r?\n/)[c.line-1];assert.equal(sha(line),c.lineSha256);assert.equal(sha(c.publicValue),c.publicValueSha256);assert.ok(line.includes('"'+c.field+'"'));assert.ok(line.includes(c.publicValue));assert.match(c.disposition,/^PUBLIC_/);if(c.sourceFile){assert.equal(sha(gunzipSync(readFileSync(new URL(c.sourceFile,root)))),c.publicValue);assert.equal(c.uncompressedSourceSha256,c.publicValue);}}
});
for(const engine of ['chromium','webkit']){
  test(`${engine}: actual review -> exact wallet envelope -> receipt -> durable recovery and reorg observations`,()=>checkConnected(reports(engine)));
  test(`${engine}: source-derived Seaport runtime, genuine Safe boundary and exact same-block attribution`,async()=>{
    const {chain:c,deployment:m,indexer:i}=reports(engine),a=loadSeaportArtifacts();assert.equal(v.keccak256(materialize(a.Seaport,seaportImmutableValues(31337,m.seaport,m.controller,v.keccak256(a.Conduit.creationCode)))),m.seaportRuntimeHash);
    const metadata=manifest.engines.find(e=>e.browser===engine);for(const binding of metadata.contractBindings){const receipt=c.receipts.find(r=>r.transactionHash===binding.creationTransactionHash);assert.equal(receipt.to,null);same(v.getContractAddress({from:receipt.from,nonce:BigInt(receipt.nonce)}),binding.address);assert.equal(receipt.nonce,binding.creationNonce);assert.equal(binding.compilerInputSha256,c.sourceInputs.synthetic.inputSha256);}
    const created=c.receipts.find(r=>r.transactionHash===metadata.core.projectCreationTransactionHash),factoryAbi=v.parseAbi(['event CurveCreated(address indexed token,address indexed curve,address indexed creator,bytes32 intentId,uint256 supply,address revenueLedger,address treasury,uint16 treasuryShareBps,string name,string symbol,string projectURI)']);same(created.to,m.coreFactory);const event=v.parseEventLogs({abi:factoryAbi,eventName:'CurveCreated',logs:created.logs});assert.equal(event.length,1);same(event[0].args.token,m.projectToken);same(event[0].args.creator,m.creator);assert.equal(String(event[0].args.supply),metadata.core.fixedSupplyWei);const mint=v.parseEventLogs({abi:v.parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']),eventName:'Transfer',logs:created.logs.filter(l=>l.address.toLowerCase()===m.projectToken.toLowerCase())}).filter(l=>l.args.from===v.zeroAddress);assert.equal(mint.length,1);assert.equal(mint[0].args.value,event[0].args.supply);
    const conduit=materialize(a.Conduit,{_controller:m.controller});assert.equal(v.keccak256(materialize(a.ConduitController,{_CONDUIT_CREATION_CODE_HASH:v.keccak256(a.Conduit.creationCode),_CONDUIT_RUNTIME_CODE_HASH:v.keccak256(conduit)})),m.pins.conduitController.runtimeHash);
    const settled=c.cases.filter(x=>x.settled);assert.equal(settled.length,6);for(const entry of settled){const receipt=entry.settled.receipt;assert.equal(receipt.status,'success');const expected=traceExpected(entry,m);assertSeaportVaultTrace(entry.settled.trace,{from:receipt.from,to:receipt.to,input:receipt.input,value:BigInt(receipt.value)},expected);const events=v.parseEventLogs({abi,eventName:'PurchaseExecuted',logs:receipt.logs});assert.equal(events.length,1);assert.equal(events[0].args.orderHash,verifier.seaportOrderDigest(entry.order).orderHash);assert.equal(events[0].args.totalCost,expected.total);}
    const safe=c.cases.find(x=>x.v2SafeAdmission);assert.equal(safe.oldVerifier.code,'UNSUPPORTED_CONTRACT_SIGNATURE');assert.equal(safe.oldVerifier.orderVerified,false);assert.equal(m.safeSeller.proxy,true);assert.equal(m.safeSeller.sourceVerified,false);assert.equal(safe.v2SafeAdmission.sourceRecompiled,false);assert.equal(safe.v2SafeAdmission.threshold,2);assert.deepEqual(safe.v2SafeAdmission.modules,[]);assert.equal(safe.v2SafeAdmission.guard,v.zeroHash);assert.equal(safe.v2SafeAdmission.signatureMagic,'0x1626ba7e');
    const orderDigest=verifier.seaportOrderDigest(safe.order).digest,safeDigest=v.hashTypedData({domain:{chainId:31337,verifyingContract:m.safeSeller.address},types:{SafeMessage:[{name:'message',type:'bytes'}]},primaryType:'SafeMessage',message:{message:v.encodeAbiParameters([{type:'bytes32'}],[orderDigest])}});assert.equal(safeDigest,safe.safeMessageDigest);for(let n=0;n<2;n++)same(await v.recoverAddress({hash:safeDigest,signature:'0x'+safe.order.signature.slice(2+n*130,2+(n+1)*130)}),safe.v2SafeAdmission.recoveredSigners[n]);assert.notEqual(safe.gasPayer.toLowerCase(),safe.order.parameters.offerer.toLowerCase());
    const batch=c.cases.find(x=>x.sameBlock),s=batch.sameBlock;for(const [part,key,index,status]of [[batch.unrelated,'unrelatedTransactionHash',0,'success'],[batch.settled,'validTransactionHash',1,'success'],[batch.cooldownRejected,'revertedTransactionHash',2,'reverted']]){same(part.receipt.transactionHash,s[key]);same(part.receipt.blockHash,s.blockHash);assert.equal(part.receipt.blockNumber,s.blockNumber);assert.equal(part.receipt.transactionIndex,index);assert.equal(part.receipt.status,status);}
    assert.equal(BigInt(batch.unrelated.receipt.value)+BigInt(s.feeAmount),BigInt(s.blockFeeDelta));assert.equal(i.sameBlock.exactReceiptFee,s.feeAmount);assert.notEqual(i.sameBlock.exactReceiptFee,s.blockFeeDelta);assert.equal(i.sameBlock.unrelatedAndRevertedExcluded,true);assert.equal(i.sameBlock.validTransactionHash,s.validTransactionHash);assert.equal(batch.cooldownRejected.trace.output,'0xaf610693');
  });
  test(`${engine}: tampering bytes, selector, nonce, listing, DB payee and trace amount is rejected`,()=>{
    const e=manifest.engines.find(e=>e.browser===engine),f=e.files[0],bytes=readFileSync(new URL(f.path,import.meta.url)),changed=Buffer.from(bytes);changed[changed.length-1]^=1;assert.throws(()=>checkStored(f,changed));
    for(const mutate of [x=>x.browser.submissions[0].request.nonce='0x99',x=>{const r=x.browser.reviews.find(r=>r.operation==='buy');r.operation='disable';const{reviewHash,...body}=r;r.reviewHash=digest(body);},x=>x.browser.reviews.find(r=>r.operation==='buy').listing.tokenId='999',x=>x.browser.recoveries[1].settlement.payments[1].amount='32000000000000',x=>x.browser.submissions.push(x.browser.submissions[0])]){const x=reports(engine);mutate(x);assert.throws(()=>checkConnected(x));}
    const x=reports(engine),batch=x.chain.cases.find(x=>x.sameBlock),expected=traceExpected(batch,x.deployment);expected.payments[1].amount=BigInt(batch.sameBlock.blockFeeDelta);assert.throws(()=>assertSeaportVaultTrace(batch.settled.trace,{from:batch.settled.receipt.from,to:batch.settled.receipt.to,input:batch.settled.receipt.input,value:0n},expected));
  });
}
