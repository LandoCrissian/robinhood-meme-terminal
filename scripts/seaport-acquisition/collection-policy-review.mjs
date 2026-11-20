import {createHash} from "node:crypto";

const address=/^0x[0-9a-f]{40}$/i,hash=/^0x[0-9a-f]{64}$/i,uint=/^(0|[1-9][0-9]{0,77})$/;
const same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const record=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const need=(ok,reason)=>{if(!ok)throw Object.assign(Error(reason),{code:reason});};
const canonical=x=>typeof x==="bigint"?String(x):Array.isArray(x)?x.map(canonical):record(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):typeof x==="string"&&/^0x/i.test(x)?x.toLowerCase():x;
const digest=x=>"0x"+createHash("sha256").update(JSON.stringify(canonical(x))).digest("hex");
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const safeReason=e=>/^[A-Z][A-Z0-9_]{0,79}$/.test(e?.code??"")?e.code:"COLLECTION_REVIEW_UNAVAILABLE";
export const collectionReviewLimits=Object.freeze({maxBytes:131072,maxRoles:8,maxChecks:12,maxIssues:24,maxAgeMs:60000,maxDepth:16,maxNodes:4096});
export const collectionReviewSeaportPins=Object.freeze({chainId:4663,address:"0x0000000000000068F116a894984e2DB1123eB395",runtimeHash:"0x95809b70c9659c30188db5fdd87103e24b1a55379af8c851fca393aba0224a00"});
const held=(reason,extra={})=>({schemaVersion:1,status:"UNAVAILABLE",reason,productionStatus:"NO_GO",executionApproved:false,executionEnabled:false,ownerApprovalRecorded:false,productionCatalogEntry:false,...extra});

function inspectData(value){
 let nodes=0;
 function visit(x,depth){need(++nodes<=collectionReviewLimits.maxNodes&&depth<=collectionReviewLimits.maxDepth,"COLLECTION_REVIEW_STRUCTURE_BOUND");
  if(record(x)||Array.isArray(x)){for(const [key,v]of Object.entries(x)){need(key.length<=96,"COLLECTION_REVIEW_STRUCTURE_BOUND");visit(v,depth+1);}}
  else need(x===null||typeof x==="boolean"||typeof x==="number"&&Number.isFinite(x)||typeof x==="bigint"&&x>=0n&&x<2n**256n||typeof x==="string"&&Buffer.byteLength(x)<=8192,"COLLECTION_REVIEW_VALUE_UNSUPPORTED");
 }
 visit(value,0);need(Buffer.byteLength(JSON.stringify(canonical(value)))<=collectionReviewLimits.maxBytes,"COLLECTION_REVIEW_BYTES_BOUND");
}
function anchor(a,nowMs){
 need(record(a)&&uint.test(a.number??"")&&hash.test(a.hash??"")&&uint.test(a.timestamp??""),"COLLECTION_ANCHOR_UNAVAILABLE");
 const timestamp=BigInt(a.timestamp)*1000n;need(timestamp<=BigInt(Number.MAX_SAFE_INTEGER)&&BigInt(a.number)<2n**256n,"COLLECTION_ANCHOR_UNAVAILABLE");
 need(nowMs>=Number(timestamp)&&nowMs-Number(timestamp)<=collectionReviewLimits.maxAgeMs,"COLLECTION_REVIEW_STALE");
 return{number:a.number,hash:a.hash.toLowerCase(),timestamp:a.timestamp};
}
function roles(input){
 need(Array.isArray(input)&&input.length>=4&&input.length<=collectionReviewLimits.maxRoles,"COLLECTION_ROLES_BOUND");
 const seen=new Set();
 for(const r of input){
  need(record(r)&&/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(r.role??"")&&!seen.has(r.role)&&address.test(r.address??"")&&hash.test(r.runtimeHash??"")&&Number.isSafeInteger(r.codeBytes)&&r.codeBytes>=0&&r.codeBytes<=65536&&record(r.source),"COLLECTION_ROLE_UNAVAILABLE");seen.add(r.role);
 }
 for(const role of["collection","implementation","validator","seaport"])need(input.some(r=>r.role===role&&r.codeBytes>0),"COLLECTION_ROLE_UNAVAILABLE");
 return [...input].sort((a,b)=>a.role<b.role?-1:a.role>b.role?1:0);
}
function issues(value){need(Array.isArray(value)&&value.length<=collectionReviewLimits.maxIssues&&value.every(x=>typeof x==="string"&&x.length>0&&x.length<=512),"COLLECTION_AUTHORITY_UNAVAILABLE");return[...new Set(value)].sort();}

/** Descriptive, bounded review of trusted read-only collector observations.
 * A fingerprint is evidence identity, never collection admission or authority.
 * In particular, source correspondence does not freeze mutable issuer policy.
 */
export function createCollectionPolicyReview(observation,{nowMs=Date.now()}={}){
 let evidenceFingerprint;
 try{
  inspectData(observation);const o=structuredClone(observation);
  evidenceFingerprint=digest(o);
  need(Number.isSafeInteger(nowMs)&&nowMs>0&&o.schemaVersion===1&&o.chainId===4663&&address.test(o.collection??"")&&uint.test(o.tokenId??"")&&BigInt(o.tokenId)<2n**256n,"COLLECTION_IDENTITY_UNAVAILABLE");
  const observed=anchor(o.anchor,nowMs),reviewedRoles=roles(o.roles);
  need(same(reviewedRoles.find(r=>r.role==="collection").address,o.collection)&&record(o.state)&&Array.isArray(o.transferChecks)&&o.transferChecks.length<=collectionReviewLimits.maxChecks,"COLLECTION_STATE_UNAVAILABLE");
  for(const c of o.transferChecks)need(record(c)&&["directTransferFrom","validatorSimulation","validatorSimulationView"].includes(c.kind)&&address.test(c.operator??"")&&address.test(c.receiver??"")&&address.test(c.from??"")&&address.test(c.to??"")&&(c.success===true||c.success===false||c.success===null)&&(c.approvalPresent===true||c.approvalPresent===false||c.approvalPresent===null),"COLLECTION_TRANSFER_EVIDENCE_UNAVAILABLE");
  const venue=reviewedRoles.find(r=>r.role==="seaport"),seaport=venue.address;
  need(same(seaport,collectionReviewSeaportPins.address)&&same(venue.runtimeHash,collectionReviewSeaportPins.runtimeHash),"COLLECTION_SEAPORT_BINDING_MISMATCH");
  for(const c of o.transferChecks.filter(x=>x.kind==="directTransferFrom"))need(same(c.from,c.operator)&&same(c.to,o.collection),"COLLECTION_TRANSFER_IDENTITY_MISMATCH");
  need(record(o.providers)&&Object.keys(o.providers).length===2&&["official","pocket"].every(k=>record(o.providers[k])),"COLLECTION_WITNESS_UNAVAILABLE");
  for(const name of["official","pocket"]){const p=o.providers[name];need(p.chainId===4663,"COLLECTION_PROVIDER_CHAIN_MISMATCH");need(p.canonicalRechecked===true,"COLLECTION_CANONICAL_WITNESS_UNAVAILABLE");need(equal(anchor(p.anchor,nowMs),observed)&&equal(roles(p.roles),reviewedRoles)&&equal(p.state,o.state)&&equal(p.transferChecks,o.transferChecks),"COLLECTION_PROVIDER_DISAGREEMENT");}
  need(record(o.authorityClosure)&&["COMPLETE","UNRESOLVED"].includes(o.authorityClosure.status),"COLLECTION_AUTHORITY_UNAVAILABLE");
  const unknowns=issues(o.authorityClosure.unknowns),mutableBoundaries=issues(o.authorityClosure.mutableBoundaries);
  const identity={chainId:4663,collection:o.collection.toLowerCase(),tokenId:o.tokenId};
  const immutable={...identity,roles:reviewedRoles};
  const mutable={state:o.state,transferChecks:o.transferChecks,authorityClosure:{status:o.authorityClosure.status,unknowns,mutableBoundaries}};
  const codeBindingFingerprint=digest(immutable),currentStateFingerprint=digest(mutable),policyFingerprint=digest({schemaVersion:1,codeBindingFingerprint,currentStateFingerprint});
  const sourceIncomplete=reviewedRoles.some(r=>r.codeBytes>0&&(r.source.fullRuntimeMatch!==true||r.source.immutableBindingsVerified!==true));
  const direct=o.transferChecks.filter(c=>c.kind==="directTransferFrom"&&same(c.operator,seaport));
  const missingApproval=direct.some(c=>c.approvalPresent===false),transferSucceeded=direct.some(c=>c.success===true&&c.approvalPresent===true);
  const restrictions=direct.filter(c=>c.success===false&&c.approvalPresent===true);
  const blockers=[...(sourceIncomplete?["SOURCE_OR_IMMUTABLE_BINDINGS_UNRESOLVED"]:[]),...(o.authorityClosure.status!=="COMPLETE"||unknowns.length?["AUTHORITY_CLOSURE_UNRESOLVED"]:[]),...(missingApproval?["SELLER_AUTHORIZATION_MISSING"]:[]),...(!direct.length?["DIRECT_TRANSFER_EVIDENCE_UNAVAILABLE"]:[]),...(restrictions.length?["CURRENT_TRANSFER_RESTRICTION"]:[]),...(mutableBoundaries.length?["MUTABLE_POLICY_NOT_BOUND_AT_EXECUTION"]:[]),"OWNER_COLLECTION_APPROVAL_UNASSIGNED","PRODUCTION_VAULT_UNRELEASED"];
  return{schemaVersion:1,status:"REVIEW_RECORDED",...identity,observed,evidenceFingerprint,codeBindingFingerprint,currentStateFingerprint,policyFingerprint,ownerApprovalReady:!sourceIncomplete&&o.authorityClosure.status==="COMPLETE"&&!unknowns.length&&!mutableBoundaries.length&&transferSucceeded&&!missingApproval&&!restrictions.length,productionStatus:"NO_GO",executionApproved:false,executionEnabled:false,ownerApprovalRecorded:false,productionCatalogEntry:false,blockers,
   sellerAuthorization:missingApproval?"MISSING":direct.length?"OBSERVED_NOT_STANDING_CONSENT":"UNKNOWN",transferCompatibility:missingApproval?"UNRESOLVED_UNTIL_SELLER_AUTHORIZATION":restrictions.length?"CURRENT_POLICY_REJECTS_TRANSFER":transferSucceeded?"CURRENT_SIMULATION_ONLY":"UNKNOWN",immutableIncompatibilityEstablished:false,
   authority:{status:o.authorityClosure.status,mutableBoundaries,unknowns},transactionTimeEnforcement:mutableBoundaries.length?"NOT_BOUND_BY_EXISTING_VAULT":"COLLECTION_SEMANTICS_STILL_REQUIRE_ADMISSION",revalidation:{currentStateRequired:true,pendingStateRequiredBeforeWalletReview:true,previousAnchorCanonicalRequired:true,maximumAgeMs:collectionReviewLimits.maxAgeMs,atomicMutablePolicyGuarantee:false},
   limitations:["This read-only review cannot approve a collection, replace a missing seller signature or authorize approval/spending.","Two RPCs corroborate observed L2 state, not independent market evidence or Ethereum L1 finality.","A missing direct seller approval and a current validator restriction are distinct; neither establishes immutable incompatibility.","Offchain canonical/pending revalidation cannot prevent same-block privileged changes or a later issuer freeze.","The production catalog remains empty. Existing vault chain31337 and security holds remain binding."]};
 }catch(error){return held(safeReason(error),{...(evidenceFingerprint&&{evidenceFingerprint}),ownerApprovalReady:false});}
}

/** Fail closed on any source, authority, approval or policy drift. This checks
 * newly collected observations; it is not atomic onchain execution protection.
 * Missing reorg evidence never silently inherits a prior successful review.
 */
export function revalidateCollectionPolicyReview(previous,current,{previousAnchorCanonical,nowMs=Date.now()}={}){
 if(previous?.status!=="REVIEW_RECORDED"||![previous.policyFingerprint,previous.codeBindingFingerprint,previous.currentStateFingerprint].every(x=>hash.test(x??""))||!record(previous.observed)||!uint.test(previous.observed.number??"")||!hash.test(previous.observed.hash??"")||!uint.test(previous.observed.timestamp??""))return held("ORIGINAL_COLLECTION_REVIEW_UNAVAILABLE");
 if(previousAnchorCanonical!==true)return held("ORIGINAL_COLLECTION_ANCHOR_UNPROVEN");
 const next=createCollectionPolicyReview(current,{nowMs});if(next.status!=="REVIEW_RECORDED")return next;
 if(BigInt(next.observed.number)<BigInt(previous.observed.number)||next.observed.number===previous.observed.number&&!same(next.observed.hash,previous.observed.hash))return held("COLLECTION_OBSERVATION_REGRESSED_OR_REORGED");
 if(!same(previous.codeBindingFingerprint,next.codeBindingFingerprint)||!same(previous.currentStateFingerprint,next.currentStateFingerprint)||!same(previous.policyFingerprint,next.policyFingerprint))return held("COLLECTION_REVIEW_CHANGED",{currentReview:next,originalPolicyFingerprint:previous.policyFingerprint});
 return{...next,revalidationStatus:"UNCHANGED_OBSERVATION",executionPreparationPermitted:false};
}
