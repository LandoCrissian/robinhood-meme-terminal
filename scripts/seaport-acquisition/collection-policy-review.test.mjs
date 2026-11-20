// Pure review-boundary fixtures. These are invented unit observations, not
// evidence that a live collection, validator or seller has been admitted.
import test from "node:test";
import assert from "node:assert/strict";
import {createCollectionPolicyReview,revalidateCollectionPolicyReview,collectionReviewSeaportPins} from "./collection-policy-review.mjs";
import {nativeProductionCollectionPolicies} from "./native-order-admission.mjs";
const a=n=>"0x"+String(n).padStart(40,"1"),h=n=>"0x"+String(n).padStart(64,"1"),time=1800000000000;
function fixture(){
 const roles=["collection","implementation","validator","seaport"].map((role,i)=>({role,address:a(i+1),runtimeHash:h(i+1),codeBytes:100,source:{status:"MOCK_UNIT_SOURCE_ONLY",responseSha256:h(i+2),fullRuntimeMatch:true,immutableBindingsVerified:true,independentlyRecompiled:false}}));
 roles[3].address=collectionReviewSeaportPins.address;roles[3].runtimeHash=collectionReviewSeaportPins.runtimeHash;
 const result={schemaVersion:1,chainId:4663,collection:a(1),tokenId:"478",anchor:{number:"100",hash:h(10),timestamp:String(time/1000)},roles,state:{collectionOwner:a(5),validator:a(3),seller:a(6),tokenApproved:a(4),operatorApprovals:{seaport:true,conduit:false},royalty:{receiver:a(5),numerator:"10",denominator:"100"}},transferChecks:[{kind:"directTransferFrom",operator:a(4),from:a(4),to:a(1),receiver:a(7),success:true,approvalPresent:true,revertData:"0x"}],authorityClosure:{status:"COMPLETE",mutableBoundaries:[],unknowns:[]}};
 function mirror(){result.providers=Object.fromEntries(["official","pocket"].map(k=>[k,{chainId:4663,anchor:structuredClone(result.anchor),roles:structuredClone(result.roles),state:structuredClone(result.state),transferChecks:structuredClone(result.transferChecks),canonicalRechecked:true}]));return result;}
 result.transferChecks[0].operator=collectionReviewSeaportPins.address;result.transferChecks[0].from=collectionReviewSeaportPins.address;result.state.tokenApproved=collectionReviewSeaportPins.address;
 return{data:mirror(),mirror,review:()=>createCollectionPolicyReview(result,{nowMs:time+1000})};
}
test("review records exact source/state fingerprints but never grants production or owner authority",()=>{
 const f=fixture(),r=f.review();assert.equal(r.status,"REVIEW_RECORDED");assert.equal(r.ownerApprovalReady,true);assert.equal(r.productionStatus,"NO_GO");assert.equal(r.executionEnabled,false);assert.equal(r.executionApproved,false);assert.equal(r.ownerApprovalRecorded,false);assert.equal(r.productionCatalogEntry,false);assert.deepEqual(nativeProductionCollectionPolicies,[]);assert.match(r.policyFingerprint,/^0x[0-9a-f]{64}$/);assert.equal(r.revalidation.atomicMutablePolicyGuarantee,false);
 const changed=f.review();assert.equal(changed.policyFingerprint,r.policyFingerprint);f.data.roles.reverse();f.mirror();assert.equal(f.review().policyFingerprint,r.policyFingerprint);
});
test("missing seller approval is distinct from current validator veto and immutable incompatibility",()=>{
 const f=fixture();f.data.transferChecks[0]={...f.data.transferChecks[0],success:false,approvalPresent:false,revertData:"0xe1f1d02e"};f.data.authorityClosure={status:"UNRESOLVED",mutableBoundaries:["ISSUER_CAN_REPLACE_VALIDATOR"],unknowns:["VALIDATOR_AUTHORITY_NOT_REVIEWED"]};f.mirror();const r=f.review();
 assert.equal(r.status,"REVIEW_RECORDED");assert.equal(r.sellerAuthorization,"MISSING");assert.equal(r.transferCompatibility,"UNRESOLVED_UNTIL_SELLER_AUTHORIZATION");assert.equal(r.immutableIncompatibilityEstablished,false);assert.equal(r.ownerApprovalReady,false);assert.equal(r.transactionTimeEnforcement,"NOT_BOUND_BY_EXISTING_VAULT");assert.ok(r.blockers.includes("SELLER_AUTHORIZATION_MISSING"));assert.ok(r.blockers.includes("MUTABLE_POLICY_NOT_BOUND_AT_EXECUTION"));
 f.data.transferChecks[0].approvalPresent=true;f.mirror();const veto=f.review();assert.equal(veto.transferCompatibility,"CURRENT_POLICY_REJECTS_TRANSFER");assert.equal(veto.immutableIncompatibilityEstablished,false);
});
test("conduit success or validator-only reads cannot qualify the required direct zero-conduit transfer",()=>{
 const f=fixture();f.data.transferChecks[0]={...f.data.transferChecks[0],operator:a(9),from:a(9)};f.mirror();const r=f.review();assert.equal(r.transferCompatibility,"UNKNOWN");assert.equal(r.ownerApprovalReady,false);assert.ok(r.blockers.includes("DIRECT_TRANSFER_EVIDENCE_UNAVAILABLE"));
 f.data.transferChecks[0]={...f.data.transferChecks[0],kind:"validatorSimulation",from:a(1),to:a(3)};f.mirror();assert.equal(f.review().ownerApprovalReady,false);
});
test("unknown source immutables/authority and mutable royalties never become approval-ready",()=>{
 for(const mutate of[d=>delete d.roles[1].source.immutableBindingsVerified,d=>d.roles[2].source.fullRuntimeMatch=false,d=>d.authorityClosure.status="UNRESOLVED",d=>d.authorityClosure.unknowns=["UNKNOWN_RULESET_OWNER"],d=>d.authorityClosure.mutableBoundaries=["OWNER_CAN_CHANGE_ROYALTY"]]){const f=fixture();mutate(f.data);f.mirror();const r=f.review();assert.equal(r.status,"REVIEW_RECORDED");assert.equal(r.ownerApprovalReady,false);assert.equal(r.productionStatus,"NO_GO");}
});
test("independent RPC missing state, chain, code or canonical evidence fails closed",()=>{
 const changes=[d=>delete d.providers.pocket,d=>d.providers.pocket.chainId=31337,d=>d.providers.pocket.canonicalRechecked=false,d=>d.providers.pocket.anchor.hash=h(99),d=>d.providers.pocket.roles[0].runtimeHash=h(99),d=>d.providers.pocket.state.collectionOwner=a(99),d=>d.providers.pocket.transferChecks[0].approvalPresent=false];
 for(const change of changes){const f=fixture();change(f.data);assert.equal(f.review().status,"UNAVAILABLE");}
});
test("identity, structure, numeric, freshness and role limits reject malformed review data",()=>{
 const changes=[d=>d.chainId=31337,d=>d.collection="RMT",d=>d.tokenId=String(2n**256n),d=>d.roles.push(...Array(5).fill(d.roles[0])),d=>d.roles[1].role=d.roles[0].role,d=>d.roles[0].codeBytes=0,d=>d.roles[3].runtimeHash=h(99),d=>d.transferChecks[0].from=a(99),d=>d.transferChecks[0].approvalPresent=undefined,d=>d.state.note="a".repeat(8193),d=>d.anchor.timestamp=String(time/1000-61)];
 for(const change of changes){const f=fixture();change(f.data);assert.equal(f.review().status,"UNAVAILABLE");}
 const f=fixture();assert.equal(createCollectionPolicyReview(f.data,{nowMs:time-1}).reason,"COLLECTION_REVIEW_STALE");assert.equal(createCollectionPolicyReview(f.data,{nowMs:Infinity}).status,"UNAVAILABLE");assert.equal(createCollectionPolicyReview(null).status,"UNAVAILABLE");
});
test("policy review is a snapshot and binds source, issuer, approval, royalty and every authority field",()=>{
 const f=fixture(),r=f.review();for(const mutate of[d=>d.roles[1].source.responseSha256=h(99),d=>d.state.collectionOwner=a(99),d=>d.state.operatorApprovals.seaport=false,d=>d.state.royalty.numerator="11",d=>d.authorityClosure.mutableBoundaries=["ISSUER_MUTABLE"]]){
  const next=fixture();mutate(next.data);next.mirror();const v=next.review();assert.equal(v.status,"REVIEW_RECORDED");assert.notEqual(v.policyFingerprint,r.policyFingerprint);
 }
 f.data.anchor.hash=h(99);assert.equal(r.observed.hash,h(10));
});
test("trusted ABI uint values and persisted decimal JSON have identical fingerprints without precision loss",()=>{
 const f=fixture();f.data.state.maxSupply=(2n**255n)+123n;f.mirror();const raw=f.review();assert.equal(raw.status,"REVIEW_RECORDED");
 f.data.state.maxSupply=String(f.data.state.maxSupply);f.mirror();assert.equal(f.review().policyFingerprint,raw.policyFingerprint);
 f.data.state.maxSupply=2n**256n;f.mirror();assert.equal(f.review().reason,"COLLECTION_REVIEW_VALUE_UNSUPPORTED");
});
test("revalidation requires fresh canonical evidence and never prepares execution",()=>{
 const f=fixture(),old=f.review();f.data.anchor={number:"101",hash:h(11),timestamp:String(time/1000+1)};f.mirror();const next=revalidateCollectionPolicyReview(old,f.data,{previousAnchorCanonical:true,nowMs:time+2000});assert.equal(next.revalidationStatus,"UNCHANGED_OBSERVATION");assert.equal(next.executionPreparationPermitted,false);assert.equal(next.policyFingerprint,old.policyFingerprint);
 for(const previousAnchorCanonical of[false,undefined,null])assert.equal(revalidateCollectionPolicyReview(old,f.data,{previousAnchorCanonical,nowMs:time+2000}).reason,"ORIGINAL_COLLECTION_ANCHOR_UNPROVEN");
 f.data.state.royalty.numerator="11";f.mirror();assert.equal(revalidateCollectionPolicyReview(old,f.data,{previousAnchorCanonical:true,nowMs:time+2000}).reason,"COLLECTION_REVIEW_CHANGED");
});
test("regressed/reorganized and interrupted observations cannot inherit a previous review",()=>{
 const f=fixture(),old=f.review();f.data.anchor.number="99";f.mirror();assert.equal(revalidateCollectionPolicyReview(old,f.data,{previousAnchorCanonical:true,nowMs:time+1000}).reason,"COLLECTION_OBSERVATION_REGRESSED_OR_REORGED");
 f.data.anchor.number="100";f.data.anchor.hash=h(99);f.mirror();assert.equal(revalidateCollectionPolicyReview(old,f.data,{previousAnchorCanonical:true,nowMs:time+1000}).reason,"COLLECTION_OBSERVATION_REGRESSED_OR_REORGED");
 assert.equal(revalidateCollectionPolicyReview(old,null,{previousAnchorCanonical:true,nowMs:time+1000}).status,"UNAVAILABLE");assert.equal(revalidateCollectionPolicyReview(null,f.data,{previousAnchorCanonical:true,nowMs:time+1000}).reason,"ORIGINAL_COLLECTION_REVIEW_UNAVAILABLE");
 for(const malformed of[{status:"REVIEW_RECORDED",policyFingerprint:h(1)},{...old,observed:null},{...old,observed:{...old.observed,number:"not-a-block"}}])assert.equal(revalidateCollectionPolicyReview(malformed,f.data,{previousAnchorCanonical:true,nowMs:time+1000}).reason,"ORIGINAL_COLLECTION_REVIEW_UNAVAILABLE");
});
