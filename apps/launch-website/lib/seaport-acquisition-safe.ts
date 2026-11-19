import {concatHex,decodeFunctionData,encodeFunctionData,hashTypedData,parseAbi,zeroAddress,type Address,type Hex} from "viem";
import {claimProfileDigest} from "./claim-profiles";
import {seaportSafeSignatures,seaportSafeTypedData,validSeaportSafeTx,verifySeaportSafeApprovals,type SeaportSafeTx} from "../../../packages/launchpad-common/seaport-vault-safe.mjs";
import * as codecs from "viem";
import type {SeaportAcquisitionRequest} from "./seaport-acquisition";
export const seaportSafeProfile="rmt-seaport-safe-admin-local-v1" as const;
export const seaportSafeOperations=["configure","disable","configure-collection","configure-fee-recipient","fund-native","approve-funding","fund-token","propose-controller","cancel-controller","accept-controller"] as const;
export type SeaportSafeOperation=typeof seaportSafeOperations[number];
export type SeaportSafeFields=Record<string,string|boolean>;
export type SeaportSafeCall={to:Address;data:Hex;value:string;runtimeHash:Hex};
export type SeaportSafeApproval={signer:Address;signature:Hex};
export type SeaportSafeProposal={schemaVersion:1;profile:typeof seaportSafeProfile;chainId:31337;scope:"synthetic-local";productionExecution:false;status:"awaiting-safe-approvals";operation:SeaportSafeOperation;fields:SeaportSafeFields;vault:Address;projectToken:Address;safe:Address;owners:Address[];threshold:2;safeNonce:string;gasPayer:Address;gasPayerNonce:string;controller:Address;controllerEpoch:string;policyEpoch:string;call:SeaportSafeCall;safeTx:SeaportSafeTx;digest:Hex;observed:{blockNumber:string;blockHash:Hex;timestamp:string};expiresAt:number;proposalHash:Hex};
export type SeaportSafeOuterReview={schemaVersion:1;profile:typeof seaportSafeProfile;chainId:31337;productionExecution:false;status:"prepared";proposal:SeaportSafeProposal;approvals:SeaportSafeApproval[];request:SeaportAcquisitionRequest;gasPayerCodeHash:Hex;maximumNetworkFeeWei:string;reviewHash:Hex};
export type SeaportSafeVerification={schemaVersion:1;profile:typeof seaportSafeProfile;chainId:31337;productionExecution:false;status:"pending"|"confirmed"|"reverted"|"reorged"|"unavailable";reviewHash:Hex;proposalHash:Hex;safe:Address;safeNonce:string;gasPayer:Address;vault:Address;transactionHash?:Hex;indexed?:boolean;canonical?:{blockNumber:string;blockHash:Hex};reason?:string};
const same=(a:unknown,b:unknown)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const address=(v:unknown):v is Address=>typeof v==="string"&&/^0x[a-f0-9]{40}$/i.test(v)&&BigInt(v)>0xffffn;
const hash=(v:unknown):v is Hex=>typeof v==="string"&&/^0x[a-f0-9]{64}$/i.test(v)&&BigInt(v)>0n;
const uint=(v:unknown):v is string=>typeof v==="string"&&/^(0|[1-9][0-9]{0,77})$/.test(v)&&BigInt(v)<2n**256n;
const quantity=(v:unknown):v is Hex=>typeof v==="string"&&/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(v);
export const seaportSafeAbi=parseAbi(seaportSafeSignatures);
export function seaportSafeProposalHash(value:Omit<SeaportSafeProposal,"proposalHash">|SeaportSafeProposal):Hex{const{proposalHash:_ignore,...rest}=value as SeaportSafeProposal;return claimProfileDigest(rest);}
export function seaportSafeOuterHash(value:Omit<SeaportSafeOuterReview,"reviewHash">|SeaportSafeOuterReview):Hex{const{reviewHash:_ignore,...rest}=value as SeaportSafeOuterReview;return claimProfileDigest(rest);}
export const seaportSafeTyped=(p:SeaportSafeProposal)=>seaportSafeTypedData(p.safe,p.safeTx);
export function canonicalSeaportSafeApprovals(values:readonly SeaportSafeApproval[]){return [...values].sort((a,b)=>BigInt(a.signer)<BigInt(b.signer)?-1:1);}
export function validSeaportSafeProposal(value:unknown):value is SeaportSafeProposal{try{
 const p=value as SeaportSafeProposal,c=p.call,tx=p.safeTx;
 return p.schemaVersion===1&&p.profile===seaportSafeProfile&&p.chainId===31337&&p.scope==="synthetic-local"&&p.productionExecution===false&&p.status==="awaiting-safe-approvals"
 &&seaportSafeOperations.includes(p.operation)&&!!p.fields&&Object.keys(p.fields).length<=8&&Object.values(p.fields).every(v=>typeof v==="boolean"||typeof v==="string"&&v.length<=2048)
 &&[p.vault,p.projectToken,p.safe,p.gasPayer,p.controller,c.to].every(address)&&!same(p.safe,p.gasPayer)
 &&Array.isArray(p.owners)&&p.owners.length===3&&p.owners.every(address)&&new Set(p.owners.map(x=>x.toLowerCase())).size===3&&p.threshold===2
 &&[p.safeNonce,p.gasPayerNonce,p.controllerEpoch,p.policyEpoch,c.value,p.observed.blockNumber].every(uint)&&BigInt(p.gasPayerNonce)<=BigInt(Number.MAX_SAFE_INTEGER)
 &&[c.runtimeHash,p.digest,p.proposalHash,p.observed.blockHash].every(hash)&&Number.isFinite(Date.parse(p.observed.timestamp))&&Number.isSafeInteger(p.expiresAt)
 &&p.expiresAt> Date.parse(p.observed.timestamp)/1000&&p.expiresAt<=Date.parse(p.observed.timestamp)/1000+300
 &&validSeaportSafeTx(tx)&&same(tx.to,c.to)&&tx.value===c.value&&same(tx.data,c.data)&&tx.nonce===p.safeNonce
 &&seaportSafeProposalHash(p)===p.proposalHash&&same(hashTypedData(seaportSafeTyped(p)),p.digest);
}catch{return false;}}
export async function verifySafeOwnerApproval(p:SeaportSafeProposal,a:SeaportSafeApproval){try{
 if(!validSeaportSafeProposal(p)||!a||Object.keys(a).length!==2||!p.owners.some(o=>same(o,a.signer))||!/^0x[0-9a-f]{130}$/i.test(a.signature)||![27,28].includes(parseInt(a.signature.slice(-2),16)))return false;
 const s=BigInt("0x"+a.signature.slice(66,130));return s>0n&&s<=0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n&&same(await codecs.recoverTypedDataAddress({...seaportSafeTyped(p),signature:a.signature}),a.signer);
}catch{return false;}}
export const verifySafeOwnerApprovals=(p:SeaportSafeProposal,a:SeaportSafeApproval[])=>verifySeaportSafeApprovals(p.safe,p.safeTx,p.owners,a,codecs);
export function safeExecutionData(p:SeaportSafeProposal,approvals:SeaportSafeApproval[]):Hex{return encodeFunctionData({abi:seaportSafeAbi,functionName:"execTransaction",args:[p.safeTx.to,BigInt(p.safeTx.value),p.safeTx.data,0,0n,0n,0n,zeroAddress,zeroAddress,concatHex(canonicalSeaportSafeApprovals(approvals).map(a=>a.signature))]});}
export function validSeaportSafeOuter(value:unknown):value is SeaportSafeOuterReview{try{
 const r=value as SeaportSafeOuterReview,p=r.proposal,q=r.request,a=r.approvals;
 if(r.schemaVersion!==1||r.profile!==seaportSafeProfile||r.chainId!==31337||r.productionExecution!==false||r.status!=="prepared"||!validSeaportSafeProposal(p)
 ||!Array.isArray(a)||a.length!==2||a.some(x=>!address(x.signer)||!/^0x[0-9a-f]{130}$/i.test(x.signature)||!p.owners.some(o=>same(o,x.signer)))||BigInt(a[0].signer)>=BigInt(a[1].signer)
 ||!hash(r.reviewHash)||!hash(r.gasPayerCodeHash)||seaportSafeOuterHash(r)!==r.reviewHash||!uint(r.maximumNetworkFeeWei)
 ||!q||Object.keys(q).length!==10||q.type!=="0x2"||q.chainId!=="0x7a69"||!same(q.from,p.gasPayer)||!same(q.to,p.safe)||q.value!=="0x0"
 ||![q.nonce,q.gas,q.maxFeePerGas,q.maxPriorityFeePerGas].every(quantity)||BigInt(q.nonce)!==BigInt(p.gasPayerNonce)||BigInt(q.gas)<=0n||BigInt(q.gas)>20_000_000n
 ||BigInt(q.maxFeePerGas)<=0n||BigInt(q.maxPriorityFeePerGas)>BigInt(q.maxFeePerGas)||BigInt(q.gas)*BigInt(q.maxFeePerGas)!==BigInt(r.maximumNetworkFeeWei)
 ||!same(q.data,safeExecutionData(p,a)))return false;
 const decoded=decodeFunctionData({abi:seaportSafeAbi,data:q.data});return decoded.functionName==="execTransaction";
}catch{return false;}}
export function seaportSafeVerificationMatches(r:SeaportSafeOuterReview,value:unknown,knownHash?:string):value is SeaportSafeVerification{try{
 const v=value as SeaportSafeVerification,p=r.proposal;return v.schemaVersion===1&&v.profile===seaportSafeProfile&&v.chainId===31337&&v.productionExecution===false
 &&["pending","confirmed","reverted","reorged","unavailable"].includes(v.status)&&v.reviewHash===r.reviewHash&&v.proposalHash===p.proposalHash
 &&same(v.safe,p.safe)&&v.safeNonce===p.safeNonce&&same(v.gasPayer,p.gasPayer)&&same(v.vault,p.vault)
 &&(v.transactionHash===undefined||hash(v.transactionHash)&&(!knownHash||same(v.transactionHash,knownHash)))
 &&(!["confirmed","reverted"].includes(v.status)||hash(v.transactionHash)&&!!v.canonical&&hash(v.canonical.blockHash)&&uint(v.canonical.blockNumber));
}catch{return false;}}

/** Local review freshness is bound to canonical time. This does not give
 * standard SafeTx signatures an onchain expiry or revoke collected approvals. */
export function seaportSafeObservationMatches(p:SeaportSafeProposal,head:{number:bigint|null;timestamp:bigint},observed:{number:bigint|null;hash:Hex|null;timestamp:bigint}){
 try{return observed.number!==null&&head.number!==null&&observed.number===BigInt(p.observed.blockNumber)&&head.number>=observed.number
  &&same(observed.hash,p.observed.blockHash)&&Date.parse(p.observed.timestamp)===Number(observed.timestamp)*1000
  &&BigInt(p.expiresAt)>observed.timestamp&&BigInt(p.expiresAt)<=observed.timestamp+300n&&head.timestamp>=observed.timestamp&&head.timestamp<BigInt(p.expiresAt);}
 catch{return false;}
}
