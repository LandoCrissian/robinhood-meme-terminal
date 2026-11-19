import assert from "node:assert/strict";
import test from "node:test";
import {privateKeyToAccount} from "viem/accounts";
import {hashTypedData,keccak256,zeroAddress,type Address,type Hex} from "viem";
import {compileSeaportSafeCall} from "../../../../packages/launchpad-common/seaport-vault-safe.mjs";
import * as viem from "viem";
import {seaportSafeProfile,seaportSafeProposalHash,seaportSafeTyped,seaportSafeOuterHash,safeExecutionData,validSeaportSafeProposal,validSeaportSafeOuter,verifySafeOwnerApproval,verifySafeOwnerApprovals,seaportSafeObservationMatches,type SeaportSafeProposal,type SeaportSafeOuterReview,type SeaportSafeApproval} from "../seaport-acquisition-safe";
import {storeSeaportSafeJournal,listSeaportSafeJournals,reconcileSeaportSafeJournal,assertSeaportSafeSubmissionAvailable,type SeaportSafeJournal} from "../seaport-acquisition-safe-recovery";
const address=(n:number)=>("0x"+n.toString(16).padStart(40,"0"))as Address,hash=("0x"+"12".repeat(32))as Hex,owners=[1,2,3].map(n=>privateKeyToAccount(("0x"+String(n).padStart(64,"0"))as Hex));
function proposal():SeaportSafeProposal{
 const pins={vault:address(100003),vaultRuntimeHash:hash,paymentToken:address(100004),paymentTokenRuntimeHash:hash,collections:[]},call=compileSeaportSafeCall(pins,"disable",{},viem);
 const partial={schemaVersion:1 as const,profile:seaportSafeProfile,chainId:31337 as const,scope:"synthetic-local" as const,productionExecution:false as const,status:"awaiting-safe-approvals" as const,operation:"disable" as const,fields:{},vault:pins.vault,projectToken:address(100005),safe:address(100001),owners:owners.map(o=>o.address),threshold:2 as const,safeNonce:"7",gasPayer:address(100002),gasPayerNonce:"9",controller:address(100001),controllerEpoch:"1",policyEpoch:"2",call,safeTx:{to:call.to,value:call.value,data:call.data,operation:0 as const,safeTxGas:"0" as const,baseGas:"0" as const,gasPrice:"0" as const,gasToken:zeroAddress,refundReceiver:zeroAddress,nonce:"7"},digest:hash,observed:{blockNumber:"10",blockHash:hash,timestamp:new Date(1700000000*1000).toISOString()},expiresAt:1700000180};
 const p={...partial,proposalHash:hash};p.digest=hashTypedData(seaportSafeTyped(p));p.proposalHash=seaportSafeProposalHash(p);return p;
}
async function approvals(p:SeaportSafeProposal):Promise<SeaportSafeApproval[]>{return(await Promise.all(owners.slice(0,2).map(async o=>({signer:o.address,signature:await o.signTypedData(seaportSafeTyped(p))})))).sort((a,b)=>BigInt(a.signer)<BigInt(b.signer)?-1:1);}
async function review(p=proposal()):Promise<SeaportSafeOuterReview>{
 const a=await approvals(p),q={type:"0x2" as const,chainId:"0x7a69" as const,from:p.gasPayer,to:p.safe,data:safeExecutionData(p,a),value:"0x0" as const,nonce:"0x9" as Hex,gas:"0x186a0" as Hex,maxFeePerGas:"0x2" as Hex,maxPriorityFeePerGas:"0x1" as Hex},r={schemaVersion:1 as const,profile:seaportSafeProfile,chainId:31337 as const,productionExecution:false as const,status:"prepared" as const,proposal:p,approvals:a,request:q,gasPayerCodeHash:keccak256("0x"),maximumNetworkFeeWei:"200000",reviewHash:hash};r.reviewHash=seaportSafeOuterHash(r);return r;
}
const storage=()=>{const data=new Map<string,string>();return{get length(){return data.size;},key:(i:number)=>[...data.keys()][i]??null,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);},clear:()=>data.clear()}as Storage;};
test("Safe protocol requires two distinct typed-data owners and exact gas payer envelope",async()=>{
 const p=proposal(),r=await review(p);assert.equal(validSeaportSafeProposal(p),true);assert.equal(validSeaportSafeOuter(r),true);assert.equal(await verifySafeOwnerApproval(p,r.approvals[0]!),true);assert.equal(await verifySafeOwnerApprovals(p,r.approvals),true);
 assert.equal(await verifySafeOwnerApprovals(p,r.approvals.slice(0,1)),false);
 const changed={...r,request:{...r.request,value:"0x1" as Hex}};changed.reviewHash=seaportSafeOuterHash(changed);assert.equal(validSeaportSafeOuter(changed),false);
 const delegated={...p,safeTx:{...p.safeTx,operation:1}};assert.equal(validSeaportSafeProposal(delegated),false);
});
test("a recomputed unkeyed proposal hash cannot extend canonical local review freshness",()=>{
 const p=proposal(),observed={number:10n,hash,timestamp:1700000000n},head={number:12n,timestamp:1700000010n};assert.equal(seaportSafeObservationMatches(p,head,observed),true);
 const future={...p,observed:{...p.observed,timestamp:new Date(1800000000*1000).toISOString()},expiresAt:1800000180};future.proposalHash=seaportSafeProposalHash(future);assert.equal(validSeaportSafeProposal(future),true,"Unkeyed shape hash alone is not canonical time evidence");assert.equal(seaportSafeObservationMatches(future,head,observed),false);
 assert.equal(seaportSafeObservationMatches(p,{number:9n,timestamp:head.timestamp},observed),false);assert.equal(seaportSafeObservationMatches(p,{...head,timestamp:1700000180n},observed),false);
});
test("hash loss, restart, terminal revert and reorg preserve the original Safe authorization",async()=>{
 const r=await review(),p=r.proposal,db=storage(),j:SeaportSafeJournal={schemaVersion:1,proposal:p,approvals:r.approvals,outer:r,stage:"hash-missing",transactionHash:null,result:null,createdAt:1,updatedAt:1};storeSeaportSafeJournal(db,j);assert.throws(()=>assertSeaportSafeSubmissionAvailable(db,p.vault,p.safe,p.gasPayer));
 const base={schemaVersion:1 as const,profile:seaportSafeProfile,chainId:31337 as const,productionExecution:false as const,reviewHash:r.reviewHash,proposalHash:p.proposalHash,safe:p.safe,safeNonce:p.safeNonce,gasPayer:p.gasPayer,vault:p.vault,transactionHash:hash,indexed:true,canonical:{blockNumber:"12",blockHash:hash}};
 const confirmed=reconcileSeaportSafeJournal(j,{...base,status:"confirmed"});storeSeaportSafeJournal(db,confirmed);assert.equal(listSeaportSafeJournals(db,p.vault)[0]!.transactionHash,hash);assertSeaportSafeSubmissionAvailable(db,p.vault,p.safe,p.gasPayer);
 const pending=reconcileSeaportSafeJournal(confirmed,{...base,status:"pending"});storeSeaportSafeJournal(db,pending);assert.equal(pending.stage,"pending");assert.deepEqual(pending.proposal,p);assert.deepEqual(pending.approvals,r.approvals);assert.deepEqual(pending.outer,r);assert.equal(pending.transactionHash,hash);assert.throws(()=>assertSeaportSafeSubmissionAvailable(db,p.vault,p.safe,p.gasPayer));
 const reverted=reconcileSeaportSafeJournal(pending,{...base,status:"reverted"});storeSeaportSafeJournal(db,reverted);assertSeaportSafeSubmissionAvailable(db,p.vault,p.safe,p.gasPayer);assert.throws(()=>storeSeaportSafeJournal(db,{...reverted,transactionHash:("0x"+"34".repeat(32))as Hex}));assert.throws(()=>reconcileSeaportSafeJournal(reverted,{...base,status:"confirmed",safeNonce:"8"}));
});
