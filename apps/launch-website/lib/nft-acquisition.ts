import {keccak256,type Address,type Hex} from "viem";
import {claimProfileDigest} from "./claim-profiles";
import {nftAcquisitionCalldataMatchesReview} from "./nft-acquisition-calldata";

export const nftAcquisitionProfile="rmt-nft-acquisition-local-v1";
export const nftAcquisitionFixtureFlag="local-reviewed-nft-acquisition-v1";
export const nftAcquisitionPath="/api/nft-acquisition";
export const nftAcquisitionOperations=["fund-native","approve-funding","fund-token","configure","configure-collection","disable","buy","schedule-controller","cancel-controller","accept-controller","schedule-nft-withdrawal","schedule-asset-withdrawal","execute-withdrawal","cancel-withdrawal"]as const;
export type NftAcquisitionOperation=typeof nftAcquisitionOperations[number];
export type NftAcquisitionPoint={blockNumber:string;blockHash:Hex;timestamp:string};
export type NftAcquisitionFields=Record<string,string|boolean>;
export type NftAcquisitionTransaction={type:"0x2";chainId:"0x7a69";from:Address;to:Address;data:Hex;value:Hex;nonce:Hex;gas:Hex;maxFeePerGas:Hex;maxPriorityFeePerGas:Hex};
export type NftAcquisitionCollection={address:Address;standard:721|1155;runtimeHash:Hex;sourceInputSha256:Hex;name:string};
export type NftAcquisitionSnapshot={schemaVersion:1;profile:typeof nftAcquisitionProfile;chainId:31337;scope:"isolated-local";executionEnabled:false;status:"ready";
  vault:Address;runtimeHash:Hex;projectToken:Address;creator:Address;controller:Address;controllerEpoch:string;controllerKind:"eoa"|"metamask-7702"|"safe-1.4.1"|"unsupported";
  venue:Address;venueRuntimeHash:Hex;paymentToken:Address;collections:NftAcquisitionCollection[];enabled:boolean;policyEpoch:string;
  policy:Record<string,string|boolean>;nativeReserveWei:string;tokenReserveWei:string;nativeSpentWei:string;tokenSpentWei:string;
  custody:Array<{collection:Address;standard:721|1155;tokenId:string;quantity:string;status:"verified"}>;
  history:{indexed:boolean;status:"ready"|"pending"|"unavailable";checkpoint?:NftAcquisitionPoint};observed:NftAcquisitionPoint;notices:string[]};
export type NftAcquisitionReview={schemaVersion:1;profile:typeof nftAcquisitionProfile;chainId:31337;scope:"isolated-local";executionEnabled:false;
  status:"prepared"|"needs-safe-approvals";operation:NftAcquisitionOperation;actor:Address;controller:Address;controllerEpoch:string;policyEpoch:string;
  kind:"eoa"|"metamask-7702"|"safe-inner";vault:Address;targetRuntimeHash:Hex;actorCodeHash:Hex;fields:NftAcquisitionFields;
  innerCall:{from:Address;to:Address;data:Hex;value:Hex};request:NftAcquisitionTransaction|null;observed:NftAcquisitionPoint;expiresAt:number;
  maximumNetworkFeeWei:string;reviewHash:Hex;notices:string[];
  listing:null|{orderHash:Hex;collection:Address;standard:721|1155;tokenId:string;quantity:string;seller:Address;paymentAsset:Address;allInWei:string;venue:Address;venueRuntimeHash:Hex;expiry:string;custody:Address;listingVerified:true;route:"synthetic-local-nondeployable"}};
export type NftAcquisitionVerification={schemaVersion:1;profile:typeof nftAcquisitionProfile;chainId:31337;executionEnabled:false;reviewHash:Hex;
  status:"pending"|"confirmed"|"reverted"|"unavailable"|"reorged";transactionHash?:Hex;canonical?:NftAcquisitionPoint;indexed?:boolean;
  snapshot?:NftAcquisitionSnapshot;settlement?:{orderHash:Hex;collection:Address;tokenId:string;quantity:string;custody:Address;paidWei:string;paymentAsset:Address};
  reason?:string;finality:"synthetic-local-not-production"};
export const nftAddress=(v:unknown):v is Address=>typeof v==="string"&&/^0x[0-9a-f]{40}$/i.test(v)&&BigInt(v)>0xffffn;
export const nftHash=(v:unknown):v is Hex=>typeof v==="string"&&/^0x[0-9a-f]{64}$/i.test(v)&&BigInt(v)>0n;
export const nftUint=(v:unknown):v is string=>typeof v==="string"&&/^(0|[1-9][0-9]{0,77})$/.test(v)&&BigInt(v)<2n**256n;
export const sameNftHex=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
export const nftPoint=(p:NftAcquisitionPoint)=>!!p&&nftUint(p.blockNumber)&&BigInt(p.blockNumber)>0n&&nftHash(p.blockHash)&&Number.isFinite(Date.parse(p.timestamp));
const quantity=(v:unknown):v is Hex=>typeof v==="string"&&/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(v);
export function nftAcquisitionReviewHash(review:NftAcquisitionReview|Omit<NftAcquisitionReview,"reviewHash">):Hex{const{reviewHash:_ignore,...value}=review as NftAcquisitionReview;return claimProfileDigest(value);}
export function validNftFields(v:unknown):v is NftAcquisitionFields{return !!v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).length<=24&&Object.values(v).every(x=>typeof x==="boolean"||typeof x==="string"&&x.length<=8192);}
export function isNftAcquisitionSnapshot(v:unknown):v is NftAcquisitionSnapshot{try{const s=v as NftAcquisitionSnapshot;return s.schemaVersion===1&&s.profile===nftAcquisitionProfile&&s.chainId===31337&&s.scope==="isolated-local"&&s.executionEnabled===false&&s.status==="ready"
  &&[s.vault,s.projectToken,s.creator,s.controller,s.venue,s.paymentToken].every(nftAddress)&&[s.runtimeHash,s.venueRuntimeHash].every(nftHash)&&[s.controllerEpoch,s.policyEpoch,s.nativeReserveWei,s.tokenReserveWei,s.nativeSpentWei,s.tokenSpentWei].every(nftUint)
  &&["eoa","metamask-7702","safe-1.4.1","unsupported"].includes(s.controllerKind)&&typeof s.enabled==="boolean"&&validNftFields(s.policy)&&nftPoint(s.observed)
  &&Array.isArray(s.collections)&&s.collections.length<=16&&s.collections.every(c=>nftAddress(c.address)&&nftHash(c.runtimeHash)&&nftHash(c.sourceInputSha256)&&[721,1155].includes(c.standard)&&typeof c.name==="string"&&c.name.length<=120)
  &&Array.isArray(s.custody)&&s.custody.length<=128&&s.custody.every(c=>nftAddress(c.collection)&&[721,1155].includes(c.standard)&&nftUint(c.tokenId)&&nftUint(c.quantity)&&c.status==="verified")
  &&["ready","pending","unavailable"].includes(s.history.status)&&typeof s.history.indexed==="boolean"&&(!s.history.indexed||s.history.status==="ready"&&!!s.history.checkpoint&&nftPoint(s.history.checkpoint))&&Array.isArray(s.notices)&&s.notices.length<=16;}catch{return false;}}
export function isNftAcquisitionReview(v:unknown):v is NftAcquisitionReview{try{const r=v as NftAcquisitionReview,q=r.request;
  if(r.schemaVersion!==1||r.profile!==nftAcquisitionProfile||r.chainId!==31337||r.scope!=="isolated-local"||r.executionEnabled!==false||!nftAcquisitionOperations.includes(r.operation)
    ||![r.actor,r.controller,r.vault,r.innerCall.from,r.innerCall.to].every(nftAddress)||![r.targetRuntimeHash,r.actorCodeHash,r.reviewHash].every(nftHash)||![r.controllerEpoch,r.policyEpoch,r.maximumNetworkFeeWei].every(nftUint)
    ||!validNftFields(r.fields)||!nftPoint(r.observed)||!Number.isSafeInteger(r.expiresAt)||r.expiresAt<=Date.parse(r.observed.timestamp)/1000||r.expiresAt>Date.parse(r.observed.timestamp)/1000+600
    ||!sameNftHex(r.innerCall.from,r.actor)||!/^0x(?:[0-9a-f]{2}){4,32768}$/i.test(r.innerCall.data)||!quantity(r.innerCall.value)||!Array.isArray(r.notices)||r.notices.length>16||nftAcquisitionReviewHash(r)!==r.reviewHash||!nftAcquisitionCalldataMatchesReview(r))return false;
  if(r.operation==="buy"&&(!r.listing||r.fields.identityConfirmed!==true||r.listing.route!=="synthetic-local-nondeployable"||r.listing.listingVerified!==true
    ||![r.listing.collection,r.listing.seller,r.listing.venue,r.listing.custody].every(nftAddress)||![r.listing.orderHash,r.listing.venueRuntimeHash].every(nftHash)
    ||![r.listing.tokenId,r.listing.quantity,r.listing.allInWei,r.listing.expiry].every(nftUint)||!sameNftHex(r.listing.custody,r.vault)))return false;
  if(r.status==="needs-safe-approvals")return r.kind==="safe-inner"&&q===null&&r.maximumNetworkFeeWei==="0"&&r.innerCall.value==="0x0";
  return r.status==="prepared"&&["eoa","metamask-7702"].includes(r.kind)&&!!q&&Object.keys(q).length===10&&q.type==="0x2"&&q.chainId==="0x7a69"&&sameNftHex(q.from,r.actor)&&sameNftHex(q.to,r.innerCall.to)&&sameNftHex(q.data,r.innerCall.data)&&q.value===r.innerCall.value
    &&[q.value,q.nonce,q.gas,q.maxFeePerGas,q.maxPriorityFeePerGas].every(quantity)&&BigInt(q.gas)>0n&&BigInt(q.gas)<=20_000_000n&&BigInt(q.maxFeePerGas)>0n&&BigInt(q.maxPriorityFeePerGas)<=BigInt(q.maxFeePerGas)&&BigInt(q.gas)*BigInt(q.maxFeePerGas)===BigInt(r.maximumNetworkFeeWei);
}catch{return false;}}
export function nftAcquisitionVerificationMatches(review:NftAcquisitionReview,v:unknown,knownHash?:string):v is NftAcquisitionVerification{try{const r=v as NftAcquisitionVerification;return !!r&&r.schemaVersion===1&&r.profile===nftAcquisitionProfile&&r.chainId===31337&&r.executionEnabled===false&&r.finality==="synthetic-local-not-production"&&r.reviewHash===review.reviewHash
  &&["pending","confirmed","reverted","unavailable","reorged"].includes(r.status)&&(r.transactionHash===undefined||nftHash(r.transactionHash)&&(!knownHash||sameNftHex(r.transactionHash,knownHash)))
  &&(!["confirmed","reverted"].includes(r.status)||!!r.transactionHash&&!!r.canonical&&nftPoint(r.canonical))
  &&(r.status!=="confirmed"||isNftAcquisitionSnapshot(r.snapshot)&&sameNftHex(r.snapshot.vault,review.vault)&&(review.operation!=="buy"||!!r.settlement&&!!review.listing&&claimProfileDigest(r.settlement)===claimProfileDigest({orderHash:review.listing.orderHash,collection:review.listing.collection,tokenId:review.listing.tokenId,quantity:review.listing.quantity,custody:review.vault,paidWei:review.listing.allInWei,paymentAsset:review.listing.paymentAsset})));}catch{return false;}}
export const nftEmptyCodeHash=keccak256("0x");
