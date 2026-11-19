import assert from "node:assert/strict";
import test from "node:test";
import {concatHex,encodeFunctionData,hashTypedData,keccak256,parseAbi,zeroAddress,type Address,type Hex} from "viem";
import {generatePrivateKey,privateKeyToAccount} from "viem/accounts";
import {isReclaimReview,reclaimProfile,reclaimReviewHash,type ReclaimReview} from "../reclaim";
import {canonicalSafeApprovals,canonicalSafeTypedData,isReclaimSafeOuterReview,isReclaimSafeProposal,reclaimSafeExecutionAbi,
  reclaimSafeOuterReviewHash,reclaimSafeProposalHash,type ReclaimSafeApproval,type ReclaimSafeOuterReview,type ReclaimSafeProposal} from "../reclaim-safe";
import {prepareReclaimSafeOuter,proposeReclaimSafe,validateReclaimSafeApproval,verifyReclaimSafeOuter} from "./reclaim-safe-actions";
import type {ReclaimFixture} from "./reclaim-fixture";

// These are server failure-boundary tests with a deliberately unavailable or
// wrong-chain read provider, not substitutes for actual isolated Safe execution.
const address=(n:number)=>("0x"+(0x2000000000000000000000000000000000000000n+BigInt(n)).toString(16))as Address;
const hash=(n:number)=>("0x"+n.toString(16).padStart(64,"0"))as Hex;
const safe=address(1),payer=address(2),campaign=address(3),factory=address(4),reward=address(5);
const owners=Array.from({length:3},()=>privateKeyToAccount(generatePrivateKey()));
const observed={blockNumber:"100",blockHash:hash(100),timestamp:"2026-11-19T01:00:00.000Z"};
function proposal():ReclaimSafeProposal{
  const data=encodeFunctionData({abi:parseAbi(["function pause()"]),functionName:"pause"});
  const inner:ReclaimReview={schemaVersion:2,profile:reclaimProfile,chainId:31337,scope:"isolated-local",executionEnabled:false,status:"needs-safe-approvals",
    operation:"pause",actor:safe,controller:safe,kind:"safe-inner",campaign,factory,rewardToken:reward,factoryRuntimeHash:hash(1),campaignRuntimeHash:hash(2),
    rewardRuntimeHash:hash(3),targetRuntimeHash:hash(2),actorCodeHash:hash(4),controllerEpoch:"1",policyEpoch:"1",fields:{},request:null,
    innerCall:{from:safe,to:campaign,data,value:"0x0"},observed,expiresAt:1800000000,maximumNetworkFeeWei:"0",rewardWei:"0",custody:"permanent-retirement",notices:[],reviewHash:hash(6)};
  inner.reviewHash=reclaimReviewHash(inner);assert.ok(isReclaimReview(inner));
  const p:ReclaimSafeProposal={schemaVersion:1,profile:reclaimProfile,chainId:31337,scope:"isolated-local",executionEnabled:false,status:"awaiting-safe-approvals",
    innerReview:inner,safe,gasPayer:payer,owners:owners.map(owner=>owner.address),threshold:2,safeNonce:"7",gasPayerNonce:"2",
    safeTx:{to:campaign,value:"0",data,operation:0,safeTxGas:"0",baseGas:"0",gasPrice:"0",gasToken:zeroAddress,refundReceiver:zeroAddress,nonce:"7"},
    digest:hash(7),observed,expiresAt:inner.expiresAt,proposalHash:hash(8)};
  p.digest=hashTypedData(canonicalSafeTypedData(p)as never);p.proposalHash=reclaimSafeProposalHash(p);assert.ok(isReclaimSafeProposal(p));return p;
}
async function outer(){
  const p=proposal(),approvals:ReclaimSafeApproval[]=canonicalSafeApprovals(await Promise.all(owners.slice(0,2).map(async owner=>({signer:owner.address,signature:await owner.signTypedData(canonicalSafeTypedData(p)as never)}))));
  const data=encodeFunctionData({abi:reclaimSafeExecutionAbi,functionName:"execTransaction",args:[campaign,0n,p.safeTx.data,0,0n,0n,0n,zeroAddress,zeroAddress,concatHex(approvals.map(a=>a.signature))]});
  const r:ReclaimSafeOuterReview={schemaVersion:1,profile:reclaimProfile,chainId:31337,scope:"isolated-local",executionEnabled:false,status:"prepared",proposal:p,approvals,
    request:{type:"0x2",chainId:"0x7a69",from:payer,to:safe,data,value:"0x0",nonce:"0x2",gas:"0x10000",maxFeePerGas:"0x2",maxPriorityFeePerGas:"0x0"},
    observed,expiresAt:p.expiresAt,maximumNetworkFeeWei:"131072",gasPayerCodeHash:keccak256("0x"),reviewHash:hash(9)};
  r.reviewHash=reclaimSafeOuterReviewHash(r);assert.ok(isReclaimSafeOuterReview(r));return r;
}
const config={curve:{rpcUrl:"http://127.0.0.1:4502",factory,factoryRuntimeHash:hash(1),registry:address(6),registryRuntimeHash:hash(2),deploymentBlock:1n,deploymentBlockHash:hash(3),feeRecipient:address(7)},
  module:{reclaimFactory:factory,factoryRuntimeHash:hash(1),rewardToken:reward,rewardTokenRuntimeHash:hash(3)}}as ReclaimFixture;

test("server refuses unsupported Safe inputs and real owner identities before making a provider request",async()=>{
  const previous=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error("No provider read authorized");};
  try{
    const p=proposal();
    await assert.rejects(proposeReclaimSafe(config,{...p.innerReview,kind:"eoa"},payer));
    await assert.rejects(proposeReclaimSafe(config,p.innerReview,"0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA"));
    const invalid={...p,threshold:1}as unknown as ReclaimSafeProposal;
    await assert.rejects(validateReclaimSafeApproval(config,invalid,{signer:owners[0].address,signature:"0x"}));
    await assert.rejects(prepareReclaimSafeOuter(config,invalid,[]));assert.equal(calls,0);
  }finally{globalThis.fetch=previous;}
});

test("invalid Safe authorizations never turn a supplied hash into successful settlement or touch the provider",async()=>{
  const previous=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error("No provider read authorized");};
  try{
    for(const mutate of[(r:ReclaimSafeOuterReview)=>{r.approvals=[r.approvals[0],r.approvals[0]];},
      (r:ReclaimSafeOuterReview)=>{r.request.to=campaign;},(r:ReclaimSafeOuterReview)=>{r.proposal.safeNonce="8";},
      (r:ReclaimSafeOuterReview)=>{r.proposal.safeTx.operation=1 as never;},(r:ReclaimSafeOuterReview)=>{r.proposal.digest=hash(99);}]){
      const r=await outer();mutate(r);r.reviewHash=reclaimSafeOuterReviewHash(r);const result=await verifyReclaimSafeOuter(config,r,hash(90));
      assert.equal(result.status,"unavailable");assert.equal(result.transactionHash,hash(90));assert.equal(result.reviewHash,r.reviewHash);
      assert.equal(result.canonical,undefined);assert.equal(result.settlement,undefined);assert.equal(result.executionEnabled,false);
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=previous;}
});

test("Safe preparation and hash recovery fail closed on wrong-chain, malformed or interrupted reads without a transaction submission",async()=>{
  const previous=globalThis.fetch;
  try{
    for(const failure of["wrong-chain","malformed","unavailable"]){
      const methods:string[]=[];
      globalThis.fetch=async(input,init)=>{
        assert.equal(new URL(input instanceof Request?input.url:String(input)).origin,"http://127.0.0.1:4502");
        const body=JSON.parse(input instanceof Request?await input.clone().text():String(init?.body));methods.push(body.method);assert.equal(body.method,"eth_chainId");
        if(failure==="unavailable")throw Error("Synthetic provider outage");
        return Response.json({jsonrpc:"2.0",id:body.id,result:failure==="wrong-chain"?"0x1237":"malformed-chain-id"});
      };
      const r=await outer();await assert.rejects(prepareReclaimSafeOuter(config,r.proposal,r.approvals));
      const result=await verifyReclaimSafeOuter(config,r,hash(91));assert.equal(result.status,"unavailable");
      assert.equal(result.transactionHash,hash(91));assert.equal(result.canonical,undefined);assert.equal(result.settlement,undefined);
      assert.equal(result.executionEnabled,false);assert.ok(methods.length>=2);assert.ok(methods.every(method=>method==="eth_chainId"));
    }
  }finally{globalThis.fetch=previous;}
});
