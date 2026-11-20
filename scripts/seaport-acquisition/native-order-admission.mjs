import {createHash} from "node:crypto";
import {parseOwnerSuppliedOrder,verifyCurrentOwnerSuppliedOrder} from "./owner-supplied-order.mjs";

const zero="0x"+"00".repeat(20),hash=/^0x[0-9a-f]{64}$/i,address=/^0x[0-9a-f]{40}$/i;
const same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const record=x=>!!x&&typeof x==="object"&&!Array.isArray(x);
const exact=(x,keys)=>record(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const need=(ok,reason)=>{if(!ok)throw Error(reason);};
const safeReason=reason=>typeof reason==="string"&&/^[A-Z][A-Z0-9_]{0,119}$/.test(reason)?reason:"NATIVE_ORDER_ADMISSION_UNAVAILABLE";
const canonical=x=>typeof x==="string"&&/^0x/i.test(x)?x.toLowerCase():Array.isArray(x)?x.map(canonical):record(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const sha=x=>"0x"+createHash("sha256").update(JSON.stringify(canonical(x))).digest("hex");
const freeze=x=>{if(record(x)||Array.isArray(x)){for(const value of Object.values(x))freeze(value);Object.freeze(x);}return x;};
const unavailable=(reason,extra={})=>({schemaVersion:1,status:"UNAVAILABLE",reason,currentOrderIndependentlyVerified:false,publicListingVerified:false,executionApproved:false,executionEnabled:false,productionStatus:"NO_GO",...extra});
const profiles={"seaport-local-31337-v1":31337,"robinhood-4663-read-only-v1":4663};

/** No collection has been admitted for production purchases. Runtime/source
 * correspondence alone cannot establish issuer, upgrade or transfer policy.
 * Admission requires a separately reviewed code change to this exact catalog;
 * owner import bytes and host options cannot manufacture that decision. */
export const nativeProductionCollectionPolicies=Object.freeze([]);

/** Stable over catalog ordering; binds every policy field, not just labels. */
export function nativeCollectionPolicyCatalogHash(policies){
 need(Array.isArray(policies)&&policies.length<=8&&policies.every(p=>record(p)&&address.test(p.address)&&Number.isSafeInteger(p.chainId)&&hash.test(p.policyHash)),"INVALID_COLLECTION_POLICY_CATALOG");
 const identities=new Set();for(const p of policies){const id=p.chainId+":"+p.address.toLowerCase();need(!identities.has(id),"DUPLICATE_COLLECTION_POLICY");identities.add(id);}
 return sha([...policies].sort((a,b)=>(a.chainId+":"+a.address.toLowerCase()).localeCompare(b.chainId+":"+b.address.toLowerCase())));
}

/** Synthetic-only policy records the actual test-control boundary rather than
 * describing mutable fault fixtures as immutable production collections.
 * This helper grants no chain4663 eligibility or live collection approval. */
export function createSyntheticNativeCollectionPolicy(pin){
 need(record(pin)&&address.test(pin.address)&&!same(pin.address,zero)&&hash.test(pin.runtimeHash)&&!same(pin.runtimeHash,"0x"+"00".repeat(32))&&hash.test(pin.sourceInputSha256)&&!same(pin.sourceInputSha256,"0x"+"00".repeat(32))&&pin.sourceVerified===true&&pin.proxy===false&&[721,1155].includes(pin.standard),"INVALID_SYNTHETIC_COLLECTION_PIN");
 const policy={schemaVersion:1,scope:"SYNTHETIC_LOCAL_FIXTURE_ONLY",chainId:31337,address:pin.address.toLowerCase(),standard:pin.standard,runtimeHash:pin.runtimeHash.toLowerCase(),sourceInputSha256:pin.sourceInputSha256.toLowerCase(),sourceReview:"LOCAL_COMPILER_FIXTURE_NOT_PRODUCTION_REVIEW",proxy:"NONE_IN_PINNED_FIXTURE",issuerPolicy:"LOCAL_MINT_AND_HOSTILE_FAULT_CONTROLS",upgradePolicy:"NO_PRODUCTION_AUTHORITY_ADMISSION",transferPolicy:"STANDARD_INTERFACE_WITH_HOSTILE_FIXTURE_CONTROLS",royaltyPolicy:"LOCAL_CONFIGURABLE_FIXTURE_ONLY"};
 return freeze({...policy,policyHash:sha(policy)});
}
function validatePolicy(policy,chainId,pin){
 const keys=["schemaVersion","scope","chainId","address","standard","runtimeHash","sourceInputSha256","sourceReview","proxy","issuerPolicy","upgradePolicy","transferPolicy","royaltyPolicy","policyHash"];
 need(exact(policy,keys)&&chainId===31337&&policy.chainId===31337&&policy.schemaVersion===1,"COLLECTION_POLICY_PROFILE_UNADMITTED");
 const expected=createSyntheticNativeCollectionPolicy(pin);
 need(JSON.stringify(canonical(policy))===JSON.stringify(canonical(expected)),"COLLECTION_POLICY_BINDING_MISMATCH");
 return expected;
}
export function parseNativeOwnerSuppliedOrder(rawUtf8,options={}){
 const parsed=parseOwnerSuppliedOrder(rawUtf8,options),order=parsed.envelope.order;
 need(order.parameters.consideration.every(p=>p.itemType===0&&same(p.token,zero)&&p.identifierOrCriteria==="0"),"NATIVE_ETH_ONLY");
 return parsed;
}

/** The legacy parser/current-state verifier is reused unchanged. This narrower
 * Task085 path additionally requires explicitly admitted source/collection
 * policy and native ETH; synthetic ERC20 regression paths remain separate. */
export async function ingestNativeOwnerSuppliedSignedOrder(rawUtf8,options={}){
 try{
  need(record(options)&&Object.keys(options).every(k=>["profile","nowMs","verifierOptions","sourceId","collectionPolicies"].includes(k)),"UNKNOWN_NATIVE_ADMISSION_OPTION");
  need(options.sourceId==="owner-supplied","SOURCE_NOT_ADMITTED");
  const nowMs=options.nowMs??Date.now(),profile=options.profile??"robinhood-4663-read-only-v1",chainId=profiles[profile];need(chainId!==undefined,"UNSUPPORTED_PROFILE");
  const parsed=parseNativeOwnerSuppliedOrder(rawUtf8,{profile,nowMs});
  need(chainId===31337||options.collectionPolicies===undefined,"CALLER_PRODUCTION_POLICY_FORBIDDEN");
  const policies=chainId===4663?nativeProductionCollectionPolicies:structuredClone(options.collectionPolicies);
  need(Array.isArray(policies)&&policies.length>0&&policies.length<=8,"COLLECTION_POLICY_UNAVAILABLE");
  const collection=parsed.envelope.order.parameters.offer[0].token;
  const matching=policies.filter(p=>same(p.address,collection));need(matching.length===1,"COLLECTION_POLICY_UNADMITTED");
  need(record(options.verifierOptions)&&record(options.verifierOptions.pins),"INDEPENDENT_CURRENT_PROOF_UNAVAILABLE");
  // Snapshot all non-provider inputs before the first external read. A caller
  // mutating a review/policy object mid-read cannot alter this admitted intent.
  const verifierOptions={...options.verifierOptions,pins:structuredClone(options.verifierOptions.pins),review:structuredClone(options.verifierOptions.review)};
  const pins=verifierOptions.pins.collections;need(Array.isArray(pins)&&pins.length<=8,"COLLECTION_SOURCE_UNVERIFIED");
  const pinMatches=pins.filter(p=>same(p.address,collection));need(pinMatches.length===1,"COLLECTION_SOURCE_UNVERIFIED");
  const policy=validatePolicy(matching[0],chainId,pinMatches[0]);
  for(const candidate of policies){const matches=pins.filter(p=>same(p.address,candidate.address));need(matches.length===1,"COLLECTION_SOURCE_UNVERIFIED");validatePolicy(candidate,chainId,matches[0]);}
  const policyCatalogHash=nativeCollectionPolicyCatalogHash(policies);
  const proof=await verifyCurrentOwnerSuppliedOrder(parsed.envelope,{profile,nowMs,verifierOptions});
  if(proof.status!=="OWNER_SUPPLIED_CURRENT_ORDER_VERIFIED")return{...proof,reason:safeReason(proof.reason),provenance:parsed.provenance};
  need(proof.verified.payment.currency===zero&&proof.verified.payment.allowanceWei===null&&proof.verified.payment.exactTemporaryApprovalRequired===false,"NATIVE_PAYMENT_PROOF_MISMATCH");
  need(same(proof.verified.nft.collection,policy.address)&&proof.verified.nft.standard===policy.standard,"COLLECTION_PROOF_MISMATCH");
  return {...proof,provenance:parsed.provenance,nativeAdmission:{schemaVersion:1,profile:"rmt-native-order-admission-v1",sourceId:"owner-supplied",policyCatalogHash,native:true,totalWei:proof.verified.payment.totalWei,sourceKind:"OWNER_SUPPLIED",scope:policy.scope,chainId,rawSha256:parsed.provenance.rawSha256,collectionPolicyHash:policy.policyHash,collection:{address:policy.address,standard:policy.standard,runtimeHash:policy.runtimeHash,sourceInputSha256:policy.sourceInputSha256},orderHash:proof.orderHash,observed:proof.observed,payment:{kind:"NATIVE_ETH",currency:zero,method:"fulfillAdvancedOrder",fulfillerConduitKey:"0x"+"00".repeat(32),valueWei:proof.verified.payment.totalWei,signedConsiderationWei:proof.verified.payment.totalWei,networkFeeIncluded:false,networkFeeStatus:"NOT_ESTIMATED"},productionApproved:false},limitations:[...proof.limitations,"Collection policy is a pinned synthetic fixture including test mint/fault controls, not a production source review.","No current live collection or public listing feed is admitted by this module."]};
 }catch(error){return unavailable(safeReason(error?.message));}
}
export async function verifyNativeOwnerOrderEntry(entry,options={}){
 if(!exact(entry,["sourceKind","sourceId","rawUtf8"])||entry.sourceKind!=="OWNER_SUPPLIED"||entry.sourceId!=="owner-supplied"||typeof entry.rawUtf8!=="string")return unavailable("SOURCE_ENTRY_UNADMITTED");
 return ingestNativeOwnerSuppliedSignedOrder(entry.rawUtf8,{...options,sourceId:entry.sourceId});
}
