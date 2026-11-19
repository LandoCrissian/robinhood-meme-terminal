import {concatHex,encodeFunctionData,hashTypedData,keccak256,parseAbi,parseEventLogs,toHex,zeroAddress,type Address,type Hex} from "viem";
import {nftAcquisitionProfile,type NftAcquisitionReview} from "../nft-acquisition";
import {canonicalSafeTypedData,canonicalSafeApprovals,isNftAcquisitionSafeProposal,isNftAcquisitionSafeOuterReview,verifyNftAcquisitionSafeApproval,verifyNftAcquisitionSafeApprovals,
  nftAcquisitionSafeExecutionAbi,nftAcquisitionSafeProposalHash,nftAcquisitionSafeOuterReviewHash,type NftAcquisitionSafeApproval,type NftAcquisitionSafeProposal,type NftAcquisitionSafeOuterReview,type NftAcquisitionSafeVerification} from "../nft-acquisition-safe";
import {claimProfileDigest,claimDelegatePin} from "../claim-profiles";
import {projectTreasuryControllerKind} from "./project-treasury-fixture";
import {prepareNftAcquisition,syntheticNftActor,verifyNftAcquisitionTransaction} from "./nft-acquisition-actions";
import {verifyNftAcquisitionContext,nftAcquisitionPoint,nftRead,requireNft,normalizeNft as address,type NftAcquisitionFixture,type NftAcquisitionRpc} from "./nft-acquisition-fixture";
import {sameHex as same} from "./curve-fixture";

const safeAbi=parseAbi(["function getOwners() view returns(address[])","function getThreshold() view returns(uint256)","function nonce() view returns(uint256)",
  "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns(bytes32)",
  "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)","event ExecutionFailure(bytes32 indexed txHash,uint256 payment)"]);
const ownerSet=(owners:readonly Address[])=>owners.map(a=>a.toLowerCase()).sort();
async function safeState(rpc:NftAcquisitionRpc,safe:Address,at:bigint){
  requireNft(await projectTreasuryControllerKind(rpc,safe,at)==="safe-1.4.1","Unknown Safe runtime, authority, modules, guard or handler");
  const[owners,threshold,nonce]=await Promise.all([nftRead<Address[]>(rpc,safe,safeAbi,"getOwners",[],at),nftRead<bigint>(rpc,safe,safeAbi,"getThreshold",[],at),nftRead<bigint>(rpc,safe,safeAbi,"nonce",[],at)]);
  requireNft(owners.length===3&&threshold===2n&&owners.every(syntheticNftActor));return{owners,nonce};
}
function safeHashArgs(proposal:NftAcquisitionSafeProposal){const s=proposal.safeTx;return[s.to,0n,s.data,0,0n,0n,0n,zeroAddress,zeroAddress,BigInt(s.nonce)]as const;}
async function validateCurrentProposal(config:NftAcquisitionFixture,proposal:NftAcquisitionSafeProposal){
  requireNft(isNftAcquisitionSafeProposal(proposal)&&syntheticNftActor(proposal.safe)&&syntheticNftActor(proposal.gasPayer));
  const{rpc,head}=await verifyNftAcquisitionContext(config);requireNft(head.timestamp<BigInt(proposal.expiresAt)
    &&same((await rpc.getBlock({blockNumber:BigInt(proposal.observed.blockNumber)})).hash!,proposal.observed.blockHash));
  const state=await safeState(rpc,proposal.safe,head.number),payerKind=await projectTreasuryControllerKind(rpc,proposal.gasPayer,head.number);
  requireNft(["eoa","metamask-7702"].includes(payerKind)&&state.nonce===BigInt(proposal.safeNonce)
    &&claimProfileDigest(ownerSet(state.owners))===claimProfileDigest(ownerSet(proposal.owners))
    &&BigInt(await rpc.getTransactionCount({address:proposal.gasPayer,blockTag:"pending"}))===BigInt(proposal.gasPayerNonce));
  const inner=await prepareNftAcquisition(config,{operation:proposal.innerReview.operation,account:proposal.safe,fields:proposal.innerReview.fields},proposal.innerReview);
  requireNft(inner.reviewHash===proposal.innerReview.reviewHash&&inner.request===null&&inner.kind==="safe-inner"
    &&same(await nftRead<Hex>(rpc,proposal.safe,safeAbi,"getTransactionHash",safeHashArgs(proposal),head.number),proposal.digest));
  return{rpc,head};
}

export async function proposeNftAcquisitionSafe(config:NftAcquisitionFixture,review:NftAcquisitionReview,gasPayer:unknown):Promise<NftAcquisitionSafeProposal>{
  requireNft(review.kind==="safe-inner"&&review.request===null&&review.status==="needs-safe-approvals"&&syntheticNftActor(gasPayer));
  const{rpc,head}=await verifyNftAcquisitionContext(config),safe=review.actor,payer=address(gasPayer),state=await safeState(rpc,safe,head.number);
  requireNft(!same(safe,payer)&&["eoa","metamask-7702"].includes(await projectTreasuryControllerKind(rpc,payer,head.number)));
  const verified=await prepareNftAcquisition(config,{operation:review.operation,account:safe,fields:review.fields},review);
  requireNft(verified.reviewHash===review.reviewHash);
  const safeTx={to:review.innerCall.to,value:"0",data:review.innerCall.data,operation:0,safeTxGas:"0",baseGas:"0",gasPrice:"0",gasToken:zeroAddress,refundReceiver:zeroAddress,nonce:state.nonce.toString()}as const;
  const partial={schemaVersion:1,profile:nftAcquisitionProfile,chainId:31337,scope:"isolated-local",executionEnabled:false,status:"awaiting-safe-approvals",innerReview:review,
    safe,gasPayer:payer,owners:state.owners,threshold:2,safeNonce:state.nonce.toString(),gasPayerNonce:String(await rpc.getTransactionCount({address:payer,blockTag:"pending"})),
    safeTx,digest:hashTypedData({domain:{chainId:31337,verifyingContract:safe},types:{SafeTx:canonicalSafeTypedData({safe,safeTx}as NftAcquisitionSafeProposal).types.SafeTx},primaryType:"SafeTx",message:safeTx}as never),
    observed:nftAcquisitionPoint(head),expiresAt:review.expiresAt}as const;
  const proposal={...partial,proposalHash:nftAcquisitionSafeProposalHash(partial)};requireNft(isNftAcquisitionSafeProposal(proposal));
  await validateCurrentProposal(config,proposal);return proposal;
}
export async function validateNftAcquisitionSafeApproval(config:NftAcquisitionFixture,proposal:NftAcquisitionSafeProposal,approval:NftAcquisitionSafeApproval){
  await validateCurrentProposal(config,proposal);requireNft(await verifyNftAcquisitionSafeApproval(proposal,approval));
  return{status:"approved",proposalHash:proposal.proposalHash,signer:approval.signer,executionEnabled:false}as const;
}
export async function prepareNftAcquisitionSafeOuter(config:NftAcquisitionFixture,proposal:NftAcquisitionSafeProposal,approvals:NftAcquisitionSafeApproval[],prior?:NftAcquisitionSafeOuterReview):Promise<NftAcquisitionSafeOuterReview>{
  const{rpc,head}=await validateCurrentProposal(config,proposal);requireNft(Array.isArray(approvals)&&approvals.length===2&&await verifyNftAcquisitionSafeApprovals(proposal,approvals));
  const ordered=canonicalSafeApprovals(approvals),data=encodeFunctionData({abi:nftAcquisitionSafeExecutionAbi,functionName:"execTransaction",args:[...safeHashArgs(proposal).slice(0,9),concatHex(ordered.map(a=>a.signature))]as never});
  await rpc.call({account:proposal.gasPayer,to:proposal.safe,data,value:0n,blockNumber:head.number});
  const[estimate,priority,latest,code,pendingCode]=await Promise.all([rpc.estimateGas({account:proposal.gasPayer,to:proposal.safe,data,value:0n,blockNumber:head.number}),rpc.estimateMaxPriorityFeePerGas(),rpc.getBlock(),
    rpc.getCode({address:proposal.gasPayer,blockNumber:head.number}),rpc.getCode({address:proposal.gasPayer,blockTag:"pending"})]);
  requireNft(same(code??"0x",pendingCode??"0x"));const gas=estimate*125n/100n,fee=(latest.baseFeePerGas??0n)*2n+priority;
  requireNft(gas>0n&&gas<=20_000_000n&&fee>0n);
  let request={type:"0x2",chainId:"0x7a69",from:proposal.gasPayer,to:proposal.safe,data,value:"0x0",nonce:toHex(BigInt(proposal.gasPayerNonce)),gas:toHex(gas),maxFeePerGas:toHex(fee),maxPriorityFeePerGas:toHex(priority)}as const;
  const codeHash=keccak256(code??"0x");
  if(prior){requireNft(isNftAcquisitionSafeOuterReview(prior)&&prior.proposal.proposalHash===proposal.proposalHash&&claimProfileDigest(prior.approvals)===claimProfileDigest(ordered)
    &&same(prior.request.data,data)&&same(prior.gasPayerCodeHash,codeHash)&&estimate<=BigInt(prior.request.gas)&&(latest.baseFeePerGas??0n)+priority<=BigInt(prior.request.maxFeePerGas));request=prior.request as typeof request;}
  const maximum=(BigInt(request.gas)*BigInt(request.maxFeePerGas)).toString();requireNft(await rpc.getBalance({address:proposal.gasPayer,blockTag:"pending"})>=BigInt(maximum));
  const partial={schemaVersion:1,profile:nftAcquisitionProfile,chainId:31337,scope:"isolated-local",executionEnabled:false,status:"prepared",proposal,approvals:ordered,request,
    observed:prior?.observed??nftAcquisitionPoint(head),expiresAt:proposal.expiresAt,maximumNetworkFeeWei:maximum,gasPayerCodeHash:codeHash}as const;
  const review={...partial,reviewHash:nftAcquisitionSafeOuterReviewHash(partial)};requireNft(isNftAcquisitionSafeOuterReview(review));
  if(prior)requireNft(review.reviewHash===prior.reviewHash);return review;
}

export async function verifyNftAcquisitionSafeOuter(config:NftAcquisitionFixture,review:NftAcquisitionSafeOuterReview,hash?:Hex):Promise<NftAcquisitionSafeVerification>{
  const p=review.proposal,base={schemaVersion:1,profile:nftAcquisitionProfile,chainId:31337,executionEnabled:false,reviewHash:review.reviewHash,proposalHash:p.proposalHash,safe:p.safe,
    gasPayer:p.gasPayer,safeNonce:p.safeNonce,operation:p.innerReview.operation,finality:"synthetic-local-not-production"}as const;
  try{
    requireNft(isNftAcquisitionSafeOuterReview(review)&&await verifyNftAcquisitionSafeApprovals(p,review.approvals));
    const result=await verifyNftAcquisitionTransaction(config,p.innerReview,hash,{request:review.request,verifyOrigin:async(rpc,receipt)=>{
      const at=receipt.blockNumber,before=at-1n,[pre,post]=await Promise.all([safeState(rpc,p.safe,before),safeState(rpc,p.safe,at)]);
      requireNft(pre.nonce===BigInt(p.safeNonce)&&post.nonce===pre.nonce+1n&&claimProfileDigest(ownerSet(pre.owners))===claimProfileDigest(ownerSet(p.owners))
        &&claimProfileDigest(ownerSet(pre.owners))===claimProfileDigest(ownerSet(post.owners))
        &&same(await nftRead<Hex>(rpc,p.safe,safeAbi,"getTransactionHash",safeHashArgs(p),before),p.digest));
      const outcomes=parseEventLogs({abi:safeAbi,logs:receipt.logs.filter(l=>same(l.address,p.safe)),strict:true}).filter(l=>l.eventName==="ExecutionSuccess"||l.eventName==="ExecutionFailure");
      requireNft(outcomes.length===1&&outcomes[0].eventName==="ExecutionSuccess"&&same(outcomes[0].args.txHash,p.digest)&&outcomes[0].args.payment===0n);
      const payerCode=await rpc.getCode({address:p.gasPayer,blockNumber:at});requireNft(same(keccak256(payerCode??"0x"),review.gasPayerCodeHash));
      const kind=await projectTreasuryControllerKind(rpc,p.gasPayer,at);requireNft(kind==="eoa"||kind==="metamask-7702");
      if(kind==="metamask-7702"){const delegate=await rpc.getCode({address:claimDelegatePin.address,blockNumber:at});requireNft(delegate&&same(keccak256(delegate),claimDelegatePin.runtimeHash));}
    }});
    return{...result,...base};
  }catch{return{...base,status:"unavailable",...(hash&&{transactionHash:hash}),reason:"Original Safe authorization, nonce, canonical receipt or permanent retirement proof is unavailable; no resubmission is authorized"};}
}
