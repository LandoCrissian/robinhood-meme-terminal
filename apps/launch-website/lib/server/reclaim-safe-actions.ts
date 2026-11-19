import {concatHex,encodeFunctionData,hashTypedData,keccak256,parseAbi,parseEventLogs,toHex,zeroAddress,type Address,type Hex} from "viem";
import {reclaimProfile,type ReclaimReview} from "../reclaim";
import {canonicalSafeTypedData,canonicalSafeApprovals,isReclaimSafeProposal,isReclaimSafeOuterReview,verifyReclaimSafeApproval,verifyReclaimSafeApprovals,
  reclaimSafeExecutionAbi,reclaimSafeProposalHash,reclaimSafeOuterReviewHash,type ReclaimSafeApproval,type ReclaimSafeProposal,type ReclaimSafeOuterReview,type ReclaimSafeVerification} from "../reclaim-safe";
import {claimProfileDigest,claimDelegatePin} from "../claim-profiles";
import {projectTreasuryControllerKind} from "./project-treasury-fixture";
import {prepareReclaim,syntheticReclaimActor,verifyReclaimTransaction} from "./reclaim-actions";
import {verifyReclaimContext,reclaimPoint,reclaimRead,requireReclaim,sameReclaim as same,normalizedReclaim as address,type ReclaimFixture,type ReclaimRpc} from "./reclaim-fixture";

const safeAbi=parseAbi(["function getOwners() view returns(address[])","function getThreshold() view returns(uint256)","function nonce() view returns(uint256)",
  "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns(bytes32)",
  "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)","event ExecutionFailure(bytes32 indexed txHash,uint256 payment)"]);
const ownerSet=(owners:readonly Address[])=>owners.map(a=>a.toLowerCase()).sort();
async function safeState(rpc:ReclaimRpc,safe:Address,at:bigint){
  requireReclaim(await projectTreasuryControllerKind(rpc,safe,at)==="safe-1.4.1","Unknown Safe runtime, authority, modules, guard or handler");
  const[owners,threshold,nonce]=await Promise.all([reclaimRead<Address[]>(rpc,safe,safeAbi,"getOwners",[],at),reclaimRead<bigint>(rpc,safe,safeAbi,"getThreshold",[],at),reclaimRead<bigint>(rpc,safe,safeAbi,"nonce",[],at)]);
  requireReclaim(owners.length===3&&threshold===2n&&owners.every(syntheticReclaimActor));return{owners,nonce};
}
function safeHashArgs(proposal:ReclaimSafeProposal){const s=proposal.safeTx;return[s.to,0n,s.data,0,0n,0n,0n,zeroAddress,zeroAddress,BigInt(s.nonce)]as const;}
async function validateCurrentProposal(config:ReclaimFixture,proposal:ReclaimSafeProposal){
  requireReclaim(isReclaimSafeProposal(proposal)&&syntheticReclaimActor(proposal.safe)&&syntheticReclaimActor(proposal.gasPayer));
  const{rpc,head}=await verifyReclaimContext(config);requireReclaim(head.timestamp<BigInt(proposal.expiresAt)
    &&same((await rpc.getBlock({blockNumber:BigInt(proposal.observed.blockNumber)})).hash!,proposal.observed.blockHash));
  const state=await safeState(rpc,proposal.safe,head.number),payerKind=await projectTreasuryControllerKind(rpc,proposal.gasPayer,head.number);
  requireReclaim(["eoa","metamask-7702"].includes(payerKind)&&state.nonce===BigInt(proposal.safeNonce)
    &&claimProfileDigest(ownerSet(state.owners))===claimProfileDigest(ownerSet(proposal.owners))
    &&BigInt(await rpc.getTransactionCount({address:proposal.gasPayer,blockTag:"pending"}))===BigInt(proposal.gasPayerNonce));
  const inner=await prepareReclaim(config,{operation:proposal.innerReview.operation,account:proposal.safe,campaign:proposal.innerReview.campaign,fields:proposal.innerReview.fields},proposal.innerReview);
  requireReclaim(inner.reviewHash===proposal.innerReview.reviewHash&&inner.request===null&&inner.kind==="safe-inner"
    &&same(await reclaimRead<Hex>(rpc,proposal.safe,safeAbi,"getTransactionHash",safeHashArgs(proposal),head.number),proposal.digest));
  return{rpc,head};
}

export async function proposeReclaimSafe(config:ReclaimFixture,review:ReclaimReview,gasPayer:unknown):Promise<ReclaimSafeProposal>{
  requireReclaim(review.kind==="safe-inner"&&review.request===null&&review.status==="needs-safe-approvals"&&syntheticReclaimActor(gasPayer));
  const{rpc,head}=await verifyReclaimContext(config),safe=review.actor,payer=address(gasPayer),state=await safeState(rpc,safe,head.number);
  requireReclaim(!same(safe,payer)&&["eoa","metamask-7702"].includes(await projectTreasuryControllerKind(rpc,payer,head.number)));
  const verified=await prepareReclaim(config,{operation:review.operation,account:safe,campaign:review.campaign,fields:review.fields},review);
  requireReclaim(verified.reviewHash===review.reviewHash);
  const safeTx={to:review.innerCall.to,value:"0",data:review.innerCall.data,operation:0,safeTxGas:"0",baseGas:"0",gasPrice:"0",gasToken:zeroAddress,refundReceiver:zeroAddress,nonce:state.nonce.toString()}as const;
  const partial={schemaVersion:1,profile:reclaimProfile,chainId:31337,scope:"isolated-local",executionEnabled:false,status:"awaiting-safe-approvals",innerReview:review,
    safe,gasPayer:payer,owners:state.owners,threshold:2,safeNonce:state.nonce.toString(),gasPayerNonce:String(await rpc.getTransactionCount({address:payer,blockTag:"pending"})),
    safeTx,digest:hashTypedData({domain:{chainId:31337,verifyingContract:safe},types:{SafeTx:canonicalSafeTypedData({safe,safeTx}as ReclaimSafeProposal).types.SafeTx},primaryType:"SafeTx",message:safeTx}as never),
    observed:reclaimPoint(head),expiresAt:review.expiresAt}as const;
  const proposal={...partial,proposalHash:reclaimSafeProposalHash(partial)};requireReclaim(isReclaimSafeProposal(proposal));
  await validateCurrentProposal(config,proposal);return proposal;
}
export async function validateReclaimSafeApproval(config:ReclaimFixture,proposal:ReclaimSafeProposal,approval:ReclaimSafeApproval){
  await validateCurrentProposal(config,proposal);requireReclaim(await verifyReclaimSafeApproval(proposal,approval));
  return{status:"approved",proposalHash:proposal.proposalHash,signer:approval.signer,executionEnabled:false}as const;
}
export async function prepareReclaimSafeOuter(config:ReclaimFixture,proposal:ReclaimSafeProposal,approvals:ReclaimSafeApproval[],prior?:ReclaimSafeOuterReview):Promise<ReclaimSafeOuterReview>{
  const{rpc,head}=await validateCurrentProposal(config,proposal);requireReclaim(Array.isArray(approvals)&&approvals.length===2&&await verifyReclaimSafeApprovals(proposal,approvals));
  const ordered=canonicalSafeApprovals(approvals),data=encodeFunctionData({abi:reclaimSafeExecutionAbi,functionName:"execTransaction",args:[...safeHashArgs(proposal).slice(0,9),concatHex(ordered.map(a=>a.signature))]as never});
  await rpc.call({account:proposal.gasPayer,to:proposal.safe,data,value:0n,blockNumber:head.number});
  const[estimate,priority,latest,code,pendingCode]=await Promise.all([rpc.estimateGas({account:proposal.gasPayer,to:proposal.safe,data,value:0n,blockNumber:head.number}),rpc.estimateMaxPriorityFeePerGas(),rpc.getBlock(),
    rpc.getCode({address:proposal.gasPayer,blockNumber:head.number}),rpc.getCode({address:proposal.gasPayer,blockTag:"pending"})]);
  requireReclaim(same(code??"0x",pendingCode??"0x"));const gas=estimate*125n/100n,fee=(latest.baseFeePerGas??0n)*2n+priority;
  requireReclaim(gas>0n&&gas<=20_000_000n&&fee>0n);
  let request={type:"0x2",chainId:"0x7a69",from:proposal.gasPayer,to:proposal.safe,data,value:"0x0",nonce:toHex(BigInt(proposal.gasPayerNonce)),gas:toHex(gas),maxFeePerGas:toHex(fee),maxPriorityFeePerGas:toHex(priority)}as const;
  const codeHash=keccak256(code??"0x");
  if(prior){requireReclaim(isReclaimSafeOuterReview(prior)&&prior.proposal.proposalHash===proposal.proposalHash&&claimProfileDigest(prior.approvals)===claimProfileDigest(ordered)
    &&same(prior.request.data,data)&&same(prior.gasPayerCodeHash,codeHash)&&estimate<=BigInt(prior.request.gas)&&(latest.baseFeePerGas??0n)+priority<=BigInt(prior.request.maxFeePerGas));request=prior.request as typeof request;}
  const maximum=(BigInt(request.gas)*BigInt(request.maxFeePerGas)).toString();requireReclaim(await rpc.getBalance({address:proposal.gasPayer,blockTag:"pending"})>=BigInt(maximum));
  const partial={schemaVersion:1,profile:reclaimProfile,chainId:31337,scope:"isolated-local",executionEnabled:false,status:"prepared",proposal,approvals:ordered,request,
    observed:prior?.observed??reclaimPoint(head),expiresAt:proposal.expiresAt,maximumNetworkFeeWei:maximum,gasPayerCodeHash:codeHash}as const;
  const review={...partial,reviewHash:reclaimSafeOuterReviewHash(partial)};requireReclaim(isReclaimSafeOuterReview(review));
  if(prior)requireReclaim(review.reviewHash===prior.reviewHash);return review;
}

export async function verifyReclaimSafeOuter(config:ReclaimFixture,review:ReclaimSafeOuterReview,hash?:Hex):Promise<ReclaimSafeVerification>{
  const p=review.proposal,base={schemaVersion:2,profile:reclaimProfile,chainId:31337,executionEnabled:false,reviewHash:review.reviewHash,proposalHash:p.proposalHash,safe:p.safe,
    gasPayer:p.gasPayer,safeNonce:p.safeNonce,operation:p.innerReview.operation,finality:"synthetic-local-not-production"}as const;
  try{
    requireReclaim(isReclaimSafeOuterReview(review)&&await verifyReclaimSafeApprovals(p,review.approvals));
    const result=await verifyReclaimTransaction(config,p.innerReview,hash,{request:review.request,verifyOrigin:async(rpc,receipt)=>{
      const at=receipt.blockNumber,before=at-1n,[pre,post]=await Promise.all([safeState(rpc,p.safe,before),safeState(rpc,p.safe,at)]);
      requireReclaim(pre.nonce===BigInt(p.safeNonce)&&post.nonce===pre.nonce+1n&&claimProfileDigest(ownerSet(pre.owners))===claimProfileDigest(ownerSet(p.owners))
        &&claimProfileDigest(ownerSet(pre.owners))===claimProfileDigest(ownerSet(post.owners))
        &&same(await reclaimRead<Hex>(rpc,p.safe,safeAbi,"getTransactionHash",safeHashArgs(p),before),p.digest));
      const outcomes=parseEventLogs({abi:safeAbi,logs:receipt.logs.filter(l=>same(l.address,p.safe)),strict:true}).filter(l=>l.eventName==="ExecutionSuccess"||l.eventName==="ExecutionFailure");
      requireReclaim(outcomes.length===1&&outcomes[0].eventName==="ExecutionSuccess"&&same(outcomes[0].args.txHash,p.digest)&&outcomes[0].args.payment===0n);
      const payerCode=await rpc.getCode({address:p.gasPayer,blockNumber:at});requireReclaim(same(keccak256(payerCode??"0x"),review.gasPayerCodeHash));
      const kind=await projectTreasuryControllerKind(rpc,p.gasPayer,at);requireReclaim(kind==="eoa"||kind==="metamask-7702");
      if(kind==="metamask-7702"){const delegate=await rpc.getCode({address:claimDelegatePin.address,blockNumber:at});requireReclaim(delegate&&same(keccak256(delegate),claimDelegatePin.runtimeHash));}
    }});
    return{...result,...base};
  }catch{return{...base,status:"unavailable",...(hash&&{transactionHash:hash}),reason:"Original Safe authorization, nonce, canonical receipt or permanent retirement proof is unavailable; no resubmission is authorized"};}
}
