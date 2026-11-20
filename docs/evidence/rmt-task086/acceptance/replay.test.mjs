import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createSeaportVerifier,seaportOrderTypes} from '../../../../packages/launchpad-common/seaport-order-verifier.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),root=new URL('./',import.meta.url),repo=new URL('../../../../',import.meta.url);
const load=path=>JSON.parse(gunzipSync(readFileSync(new URL(path,root))));
test('Task086 original local fork evidence, synthetic signature, rejection rollback and real eth_calls',async()=>{
 const m=JSON.parse(readFileSync(new URL('integrity-manifest.json',root)));
 for(const x of m.members){const stored=readFileSync(new URL(x.path,root)),raw=gunzipSync(stored);assert.equal(hash(stored),x.storedSha256);assert.equal(hash(raw),x.rawSha256);assert.equal(stored.length,x.storedBytes);assert.equal(raw.length,x.rawBytes);}
 for(const x of m.sourceFiles)assert.equal(hash(readFileSync(new URL(x.path,repo))),x.sha256,x.path);
 const a=load('local4/task086-collection-acceptance.json.gz'),f=load('local4/chain/seaport-acquisition-fixture-evidence.json.gz'),d=load('local4/chain/seaport-acquisition-deployment.json.gz'),real=load('local4/task086-real-collection-fork.json.gz');
 assert.equal(a.status,'PASS');assert.equal(f.status,'PASS');assert.equal(f.receipts.length,86);assert.equal(f.cases.length,11);assert.equal(a.cases.length,7);
 assert.equal(a.production,false);assert.equal(a.ownerSignatures,false);assert.equal(a.currentLiveOrderQualified,false);assert.equal(a.productionCollectionAdmitted,false);assert.ok(Object.values(a.checks).every(x=>x===true));
 assert.equal(f.sourceInputs.candidate.inputSha256,m.candidateCompilerInputSha256);assert.equal(d.compilerInputSha256,m.candidateCompilerInputSha256);assert.equal(m.candidateCompilerInputSha256,'3fbc55312a027e5f69b16fb927c8549efcc6674bab509c792efdc0104083c5f5');
 const v=createRequire(new URL('../../../../apps/indexer/package.json',import.meta.url))('viem'),verifier=createSeaportVerifier(v),order=a.baseline.order,n=verifier.normalizeSeaportOrder(order),digest=verifier.seaportOrderDigest(order);
 assert.equal((await v.recoverTypedDataAddress({domain:digest.domain,types:seaportOrderTypes,primaryType:'OrderComponents',message:n.components,signature:order.signature})).toLowerCase(),order.parameters.offerer.toLowerCase());
 assert.equal(a.baseline.proof.currentOrderIndependentlyVerified,true);assert.equal(a.finalRestoredOrder.proof.currentOrderIndependentlyVerified,true);assert.equal(a.finalRestoredOrder.sameSignedOrderHash,true);assert.equal(a.baseline.proof.orderHash,a.finalRestoredOrder.originalOrderHash);assert.equal(a.finalRestoredOrder.proof.orderHash,a.baseline.proof.orderHash);
 const reasons=['OWNERSHIP_OR_APPROVAL_MISMATCH','NONCANONICAL_EOA_SIGNATURE','UNSUPPORTED_CONDUIT','ORDER_NOT_CURRENT_OR_NEAR_EXPIRY','OWNERSHIP_OR_APPROVAL_MISMATCH','ROYALTY_REVIEW_MISMATCH'];
 for(const [i,c]of a.cases.entries()){assert.equal(c.receipt.status,'reverted');assert.deepEqual(c.receipt.logs,[]);assert.deepEqual(c.before,c.after);assert.deepEqual(c.receipt,f.receipts.find(r=>r.transactionHash===c.receipt.transactionHash));if(i<6){assert.equal(c.proof.reason,reasons[i]);assert.equal(c.proof.currentOrderIndependentlyVerified,false);assert.equal(c.proof.executionEnabled,false);}else assert.equal(c.proof.currentOrderIndependentlyVerified,true);}
 assert.deepEqual(a.realCollection,real);assert.equal(real.status,'PASS');assert.equal(real.anchor.chainId,31337);assert.equal(real.upstream.chainId,4663);assert.equal(real.receiver.address,d.vault);assert.equal(real.receiver.runtimeHash,d.vaultRuntimeHash);assert.equal(real.currentSignedOrder,'CURRENT_ORDER_UNAVAILABLE');assert.equal(real.upstreamBroadcasts,0);
 for(const x of [real.directTransferFrom,real.validatorCall,real.validatorSimulation]){assert.equal(x.request.method,'eth_call');assert.equal(x.request.params.length,2);assert.equal(x.broadcast,false);assert.equal(hash(x.rawUtf8),x.rawSha256);}
 assert.equal(real.directTransferFrom.selector,'0x59c896be');assert.equal(real.validatorCall.selector,'0xe1f1d02e');assert.deepEqual(real.validatorSimulation.decoded,{allowed:false,errorSelector:'0xe1f1d02e'});assert.equal(real.classification.immutableIncompatibilityEstablished,false);
 for(const path of ['failures/local/native-order-admission-evidence.json.gz','failures/local2/native-order-admission-evidence.json.gz','failures/local3/task086-collection-acceptance.json.gz'])assert.equal(load(path).status,'incomplete');
 assert.equal(load('failures/local3/task086-collection-acceptance.json.gz').cases.length,6);assert.equal(v.toFunctionSelector('InvalidPolicy()'),'0xd06b96b1');assert.match(gunzipSync(readFileSync(new URL('failures/local3/standalone-failure.txt.gz',root))).toString(),/0xd06b96b1/);
 assert.equal(m.privacy.unknown,0);assert.equal(m.privacy.rawFindings,36);assert.equal(m.privacy.classifiedFindings,36);assert.equal(hash(readFileSync(new URL('.gitleaks.toml',repo))),m.privacy.configSha256);
 for(const [file,expected]of [[m.privacy.originalReport,m.privacy.originalReportSha256],[m.privacy.classifications,m.privacy.classificationsSha256]])assert.equal(hash(readFileSync(new URL(file,root))),expected);
 console.log(JSON.stringify({status:'PASS',scope:'OFFLINE_RETAINED_EVIDENCE_VERIFICATION_NOT_NEW_CHAIN_EXECUTION',production:false,originalFiles:m.members.length,receipts:86,baselineCases:11,negativeRollbackCases:7,verifiedSyntheticSellerSignatures:1,retainedRealTransferValidatorCallPairs:3,partialAttempts:3}));
});
