import {encodeFunctionData,erc20Abi,keccak256,parseEventLogs,toHex,type Address,type Hex} from "viem";
import {reclaimOperations,reclaimProfile,reclaimAddress,reclaimHash,reclaimUint,validReclaimFields,isReclaimReview,reclaimReviewHash,
  type ReclaimFields,type ReclaimOperation,type ReclaimReview,type ReclaimVerification} from "../reclaim";
import {claimProfileDigest,claimDelegatePin} from "../claim-profiles";
import {projectTreasuryControllerKind} from "./project-treasury-fixture";
import {readTreasuryBody} from "./project-treasury-actions";
import {configuredReclaimFixture,reclaimFactoryAbi,reclaimCampaignAbi,reclaim721Abi,reclaim1155Abi,reclaimEligibility,readReclaimProof,readReclaimSnapshot,
  verifyReclaimContext,reclaimRead,reclaimPoint,requireReclaim,sameReclaim as same,normalizedReclaim as normalized,
  type ReclaimFixture,type ReclaimRpc,type ReclaimHead} from "./reclaim-fixture";

const responseHeaders={"Cache-Control":"private, no-store","Netlify-CDN-Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow"};
const reply=(body:object,status=200)=>Response.json(body,{status,headers:responseHeaders});
const realAddresses=new Set(["0x7e8e7d3af28584a8b9eeddbe16cd3308bd1e76ca","0xc447a378cfd8460febc2eef67501d7a5473b9001","0xc3600f2df60929d2ab9ab294cff42eedcb984f51","0x2bcc3fafce77ccc7fdbed46e0b5bb80ba3e76697","0xaf9f10258b091719618c19d057f9cdab72effd8b","0x8d44078642ce938fd799b23087bcdd6114a302e5"]);
export const syntheticReclaimActor=(value:unknown):value is Address=>reclaimAddress(value)&&!realAddresses.has(value.toLowerCase());
const keys=(body:Record<string,unknown>,required:string[],optional:string[]=[])=>required.every(k=>Object.hasOwn(body,k))&&Object.keys(body).every(k=>required.includes(k)||optional.includes(k));
const callData=(abi:readonly unknown[],functionName:string,args:readonly unknown[]=[])=>encodeFunctionData({abi,functionName,args}as never);
const permissionless=new Set<ReclaimOperation>(["execute-collection","execute-rate","execute-close","execute-recovery","cancel-collection","cancel-rate","cancel-close","cancel-recovery","cancel-controller"]);

async function operationTerms(config:ReclaimFixture,rpc:ReclaimRpc,head:ReclaimHead,actor:Address,campaign:Address,operation:ReclaimOperation,fields:ReclaimFields,prior?:ReclaimReview){
  const m=config.module;let target=campaign,targetRuntimeHash:Hex,rewardWei="0",controllerEpoch="0",policyEpoch="0",data:Hex,nft:ReclaimReview["nft"],transfer:ReclaimReview["transfer"];
  if(operation==="create-campaign"){
    requireReclaim(syntheticReclaimActor(fields.controller));
    requireReclaim(await projectTreasuryControllerKind(rpc,normalized(fields.controller!),head.number)!=="unsupported");
    const predicted=await reclaimRead<Address>(rpc,m.reclaimFactory,reclaimFactoryAbi,"predict",[actor,fields.intentId,normalized(fields.controller!),BigInt(fields.rewardPerUnit!),Number(fields.walletCap!)],head.number);
    requireReclaim(same(predicted,campaign));const existing=await rpc.getCode({address:campaign,blockNumber:head.number});requireReclaim(!existing||existing==="0x");
    const {materializeReclaimRuntime}=await import("../../../../packages/launchpad-common/reclaim-runtime.mjs");
    const expected=materializeReclaimRuntime(m.campaignRuntimeTemplate,m.campaignImmutableReferences,m.campaignImmutableNames,
      {creator:actor,deploymentFactory:m.reclaimFactory,rewardToken:m.rewardToken,rewardRuntimeHash:m.rewardTokenRuntimeHash,deploymentChainId:31337});
    target=m.reclaimFactory;targetRuntimeHash=m.factoryRuntimeHash;
    data=callData(reclaimFactoryAbi,"create",[fields.intentId,normalized(fields.controller!),BigInt(fields.rewardPerUnit!),Number(fields.walletCap!)]);
    return{target,targetRuntimeHash,data,rewardWei,controllerEpoch,policyEpoch,campaignRuntimeHash:keccak256(expected),controller:normalized(fields.controller!),nft,transfer};
  }
  const proof=await readReclaimProof(config,rpc,campaign,head);targetRuntimeHash=proof.runtimeHash;
  const[controller,ce,pe]=await Promise.all([reclaimRead<Address>(rpc,campaign,reclaimCampaignAbi,"controller",[],head.number),reclaimRead<bigint>(rpc,campaign,reclaimCampaignAbi,"controllerEpoch",[],head.number),reclaimRead<bigint>(rpc,campaign,reclaimCampaignAbi,"policyEpoch",[],head.number)]);
  controllerEpoch=ce.toString();policyEpoch=pe.toString();
  const publicAction=permissionless.has(operation)||["redeem","return","approve-return","approve-721","approve-1155","revoke-1155","accept-controller"].includes(operation);
  requireReclaim(publicAction||same(controller,actor),"This operation requires the campaign controller");
  const deadline=prior?BigInt(prior.expiresAt):head.timestamp+180n;
  if(["approve-funding","fund"].includes(operation)){
    requireReclaim(same(controller,actor));const amount=BigInt(fields.amountWei!);rewardWei=amount.toString();
    requireReclaim(amount<=1_000_000_000n*10n**18n);
    if(operation==="approve-funding"){target=m.rewardToken;targetRuntimeHash=m.rewardTokenRuntimeHash;data=callData(erc20Abi,"approve",[campaign,amount]);}
    else{data=callData(reclaimCampaignAbi,"fund",[amount]);transfer={asset:m.rewardToken,from:actor,to:campaign,amountWei:amount.toString()};}
  }else if(["approve-721","approve-1155","revoke-1155","propose-collection","disable-collection","redeem"].includes(operation)){
    const collection=normalized(fields.collection!),eligibility=reclaimEligibility(config,campaign,collection),asset=eligibility.asset;
    const code=await rpc.getCode({address:asset.address,blockNumber:head.number});requireReclaim(code&&same(keccak256(code),asset.runtimeHash));
    if(operation==="approve-721"){
      requireReclaim(asset.standard===1&&asset.items.some(i=>i.tokenId===fields.tokenId));
      requireReclaim(same(await reclaimRead<Address>(rpc,collection,reclaim721Abi,"ownerOf",[BigInt(fields.tokenId!)],head.number),actor));
      target=collection;targetRuntimeHash=asset.runtimeHash;data=callData(reclaim721Abi,"approve",[campaign,BigInt(fields.tokenId!)]);
    }else if(operation==="approve-1155"||operation==="revoke-1155"){
      requireReclaim(asset.standard===2);target=collection;targetRuntimeHash=asset.runtimeHash;data=callData(reclaim1155Abi,"setApprovalForAll",[campaign,operation==="approve-1155"]);
    }else if(operation==="propose-collection"){
      requireReclaim(same(controller,actor));data=callData(reclaimCampaignAbi,"proposeCollection",[collection,asset.standard,asset.runtimeHash,eligibility.root,Number(fields.collectionCap!),Number(fields.collectionWalletCap!),BigInt(fields.expiresAt!)]);
    }else if(operation==="disable-collection"){requireReclaim(same(controller,actor));data=callData(reclaimCampaignAbi,"disableCollection",[collection]);}
    else{
      const selected=fields.tokenIds!.map(id=>{const item=eligibility.items.find(i=>i.tokenId===id);requireReclaim(item,"NFT ID is not in this campaign's finite fixture policy");return item;});
      const ids=selected.map(i=>BigInt(i.tokenId)),quantities=fields.quantities!.map(BigInt),maximums=selected.map(i=>BigInt(i.maxQuantity)),proofs=selected.map(i=>i.proof);
      nft={collection,tokenIds:ids.map(String),quantities:quantities.map(String)};
      const quoted=await reclaimRead<readonly[bigint,number]>(rpc,campaign,reclaimCampaignAbi,"quote",[collection,ids,quantities,maximums,proofs,actor],head.number);
      requireReclaim(quoted[0]>0n);rewardWei=quoted[0].toString();
      transfer={asset:m.rewardToken,from:campaign,to:actor,amountWei:rewardWei};
      const nonce=await reclaimRead<bigint>(rpc,campaign,reclaimCampaignAbi,"claimantNonces",[actor],head.number);
      data=callData(reclaimCampaignAbi,"redeem",[collection,ids,quantities,maximums,proofs,pe,quoted[0],nonce,deadline]);
    }
  }else if(operation==="approve-return"||operation==="return"){
    const r=await reclaimRead<readonly[Address,Address,number,bigint,bigint,number,number]>(rpc,campaign,reclaimCampaignAbi,"tradeIns",[BigInt(fields.receiptId!)],head.number);
    requireReclaim(r[6]===1&&same(r[0],actor));rewardWei=r[4].toString();
    const items=await reclaimRead<readonly[readonly bigint[],readonly bigint[]]>(rpc,campaign,reclaimCampaignAbi,"receiptItems",[BigInt(fields.receiptId!)],head.number);
    nft={collection:r[1],tokenIds:items[0].map(String),quantities:items[1].map(String),receiptId:fields.receiptId!};
    if(operation==="approve-return"){target=m.rewardToken;targetRuntimeHash=m.rewardTokenRuntimeHash;data=callData(erc20Abi,"approve",[campaign,r[4]]);}
    else{data=callData(reclaimCampaignAbi,"returnTradeIn",[BigInt(fields.receiptId!),deadline]);transfer={asset:m.rewardToken,from:actor,to:campaign,amountWei:rewardWei};}
  }else{
    const noArgs:Partial<Record<ReclaimOperation,string>>={pause:"pause",resume:"resume","execute-collection":"executeCollection","cancel-collection":"cancelCollection","execute-rate":"executeRate","cancel-rate":"cancelRate","propose-close":"proposeClose","execute-close":"executeClose","cancel-close":"cancelClose","execute-recovery":"executeRecovery","cancel-recovery":"cancelRecovery","accept-controller":"acceptController","cancel-controller":"cancelController"};
    if(operation==="propose-rate")data=callData(reclaimCampaignAbi,"proposeRate",[BigInt(fields.rewardPerUnit!),BigInt(fields.expiresAt!)]);
    else if(operation==="propose-recovery")data=callData(reclaimCampaignAbi,"proposeRecovery",[BigInt(fields.amountWei!),BigInt(fields.expiresAt!)]);
    else if(operation==="propose-controller"){requireReclaim(syntheticReclaimActor(fields.next)&&await projectTreasuryControllerKind(rpc,normalized(fields.next!),head.number)!=="unsupported");data=callData(reclaimCampaignAbi,"proposeController",[normalized(fields.next!),BigInt(fields.expiresAt!)]);}
    else{requireReclaim(noArgs[operation]);data=callData(reclaimCampaignAbi,noArgs[operation]!,operation==="propose-close"?[BigInt(fields.expiresAt!)]:[]);}
    if(operation==="execute-recovery"){const notice=await reclaimRead<readonly[bigint,number,number,bigint]>(rpc,campaign,reclaimCampaignAbi,"pendingRecovery",[],head.number);rewardWei=notice[0].toString();transfer={asset:m.rewardToken,from:campaign,to:controller,amountWei:rewardWei};}
  }
  return{target,targetRuntimeHash,data,rewardWei,controllerEpoch,policyEpoch,campaignRuntimeHash:proof.runtimeHash,controller,nft,transfer};
}

export async function prepareReclaim(config:ReclaimFixture,body:Record<string,unknown>,prior?:ReclaimReview):Promise<ReclaimReview>{
  requireReclaim(syntheticReclaimActor(body.account)&&reclaimOperations.includes(body.operation as ReclaimOperation));
  const actor=normalized(body.account),operation=body.operation as ReclaimOperation;
  requireReclaim(validReclaimFields(operation,body.fields));const fields=body.fields;
  const{rpc,head}=await verifyReclaimContext(config),m=config.module;
  let campaign:Address;
  if(operation==="create-campaign")campaign=await reclaimRead<Address>(rpc,m.reclaimFactory,reclaimFactoryAbi,"predict",[actor,fields.intentId,normalized(fields.controller!),BigInt(fields.rewardPerUnit!),Number(fields.walletCap!)],head.number);
  else{requireReclaim(reclaimAddress(body.campaign));campaign=normalized(body.campaign);}
  const terms=await operationTerms(config,rpc,head,actor,campaign,operation,fields,prior);
  const kind=await projectTreasuryControllerKind(rpc,actor,head.number);requireReclaim(kind!=="unsupported");
  requireReclaim(operation!=="create-campaign"||kind!=="safe-1.4.1","Safe campaign creation is not admitted by this fixture's direct-creator receipt verifier");
  const actorCode=await rpc.getCode({address:actor,blockNumber:head.number}),observed=prior?.observed??reclaimPoint(head),expiresAt=prior?.expiresAt??Number(head.timestamp)+180;
  requireReclaim(head.timestamp<BigInt(expiresAt)&&same((await rpc.getBlock({blockNumber:BigInt(observed.blockNumber)})).hash!,observed.blockHash));
  if(prior)requireReclaim(same(prior.actor,actor)&&same(prior.campaign,campaign)&&prior.operation===operation&&claimProfileDigest(prior.fields)===claimProfileDigest(fields)
    &&prior.controllerEpoch===terms.controllerEpoch&&prior.policyEpoch===terms.policyEpoch&&same(prior.innerCall.data,terms.data)&&prior.rewardWei===terms.rewardWei
    &&same(prior.controller,terms.controller)&&claimProfileDigest(prior.transfer??null)===claimProfileDigest(terms.transfer??null)
    &&claimProfileDigest(prior.nft??null)===claimProfileDigest(terms.nft??null));
  const innerCall={from:actor,to:terms.target,data:terms.data,value:"0x0"as const};
  let request:ReclaimReview["request"]=null,maximumNetworkFeeWei="0";
  await rpc.call({account:actor,to:terms.target,data:terms.data,value:0n,blockNumber:head.number});
  if(kind!=="safe-1.4.1"){
    const[nonce,pendingCode,estimate,latest,priority]=await Promise.all([rpc.getTransactionCount({address:actor,blockTag:"pending"}),rpc.getCode({address:actor,blockTag:"pending"}),
      rpc.estimateGas({account:actor,to:terms.target,data:terms.data,value:0n,blockNumber:head.number}),rpc.getBlock({blockTag:"latest"}),rpc.estimateMaxPriorityFeePerGas()]);
    requireReclaim(same(pendingCode??"0x",actorCode??"0x")&&Number.isSafeInteger(nonce));const gas=estimate*125n/100n,fee=(latest.baseFeePerGas??0n)*2n+priority;
    requireReclaim(gas>0n&&gas<=20_000_000n&&fee>0n);
    request={type:"0x2",chainId:"0x7a69",...innerCall,nonce:toHex(nonce),gas:toHex(gas),maxFeePerGas:toHex(fee),maxPriorityFeePerGas:toHex(priority)};
    if(prior?.request){requireReclaim(BigInt(prior.request.nonce)===BigInt(nonce)&&estimate<=BigInt(prior.request.gas)&&(latest.baseFeePerGas??0n)+priority<=BigInt(prior.request.maxFeePerGas));request=prior.request;}
    maximumNetworkFeeWei=(BigInt(request.gas)*BigInt(request.maxFeePerGas)).toString();requireReclaim(await rpc.getBalance({address:actor,blockTag:"pending"})>=BigInt(maximumNetworkFeeWei));
  }
  const partial:Omit<ReclaimReview,"reviewHash">={schemaVersion:1,profile:reclaimProfile,chainId:31337,scope:"isolated-local",executionEnabled:false,status:request?"prepared":"needs-safe-approvals",
    operation,actor,controller:terms.controller,kind:kind==="safe-1.4.1"?"safe-inner":kind,campaign,factory:m.reclaimFactory,rewardToken:m.rewardToken,factoryRuntimeHash:m.factoryRuntimeHash,
    campaignRuntimeHash:terms.campaignRuntimeHash,rewardRuntimeHash:m.rewardTokenRuntimeHash,targetRuntimeHash:terms.targetRuntimeHash,actorCodeHash:keccak256(actorCode??"0x"),
    controllerEpoch:terms.controllerEpoch,policyEpoch:terms.policyEpoch,fields,request,innerCall,observed,expiresAt,maximumNetworkFeeWei,rewardWei:terms.rewardWei,custody:"reversible-escrow",...(terms.nft&&{nft:terms.nft}),...(terms.transfer&&{transfer:terms.transfer}),
    notices:["Synthetic chain31337 only. This is not a live RMT or USD-priced reward.","NFTs enter reversible escrow, not burn. Only the original claimant can return the exact original reward to recover the NFTs; eligibility stays consumed.",
      "Every transaction requires its own explicit test-wallet confirmation. No campaign may use protocol or project treasury funds automatically.",
      ...(operation==="approve-1155"?["ERC-1155 exposes collection-wide operator approval. This approves only the reviewed campaign; explicitly revoke it after use."]:[]),
      ...(kind==="safe-1.4.1"?["Unsigned Safe inner CALL only; its owners must approve through the Safe. An EOA owner cannot impersonate Safe-owned NFTs."]:[])]};
  const result={...partial,reviewHash:reclaimReviewHash(partial)};requireReclaim(isReclaimReview(result));return result;
}

async function verifyTokenDelta(config:ReclaimFixture,rpc:ReclaimRpc,receipt:Awaited<ReturnType<ReclaimRpc["getTransactionReceipt"]>>,from:Address,to:Address,amount:bigint){
  const logs=parseEventLogs({abi:erc20Abi,eventName:"Transfer",logs:receipt.logs.filter(l=>same(l.address,config.module.rewardToken)),strict:true});
  requireReclaim(logs.length===1&&same(logs[0].args.from,from)&&same(logs[0].args.to,to)&&logs[0].args.value===amount);
  const balance=(account:Address,at:bigint)=>reclaimRead<bigint>(rpc,config.module.rewardToken,erc20Abi,"balanceOf",[account],at);
  const[fb,fa,tb,ta]=await Promise.all([balance(from,receipt.blockNumber-1n),balance(from,receipt.blockNumber),balance(to,receipt.blockNumber-1n),balance(to,receipt.blockNumber)]);
  requireReclaim(fb>=fa&&fb-fa===amount&&ta>=tb&&ta-tb===amount);
}

export async function verifyReclaimTransaction(config:ReclaimFixture,review:ReclaimReview,hash?:Hex):Promise<ReclaimVerification>{
  const base={schemaVersion:1,profile:reclaimProfile,chainId:31337,executionEnabled:false,reviewHash:review.reviewHash,finality:"synthetic-local-not-production"}as const;
  try{
    requireReclaim(isReclaimReview(review)&&review.request&&same(review.factory,config.module.reclaimFactory)&&same(review.rewardToken,config.module.rewardToken)
      &&same(review.factoryRuntimeHash,config.module.factoryRuntimeHash)&&same(review.rewardRuntimeHash,config.module.rewardTokenRuntimeHash));
    const{rpc,head}=await verifyReclaimContext(config),q=review.request;
    if(!same((await rpc.getBlock({blockNumber:BigInt(review.observed.blockNumber)})).hash!,review.observed.blockHash))return{...base,status:"reorged",...(hash&&{transactionHash:hash}),reason:"Original review anchor invalidated by a reorg; retain the request and hash"};
    const anchor={...await rpc.getBlock({blockNumber:BigInt(review.observed.blockNumber)}),number:BigInt(review.observed.blockNumber),hash:review.observed.blockHash}as ReclaimHead;
    const original=await operationTerms(config,rpc,anchor,review.actor,review.campaign,review.operation,review.fields,review);
    requireReclaim(same(original.data,q.data)&&same(original.target,q.to)&&same(original.targetRuntimeHash,review.targetRuntimeHash)&&original.rewardWei===review.rewardWei
      &&original.policyEpoch===review.policyEpoch&&original.controllerEpoch===review.controllerEpoch&&same(original.controller,review.controller)
      &&claimProfileDigest(original.transfer??null)===claimProfileDigest(review.transfer??null)&&claimProfileDigest(original.nft??null)===claimProfileDigest(review.nft??null));
    let found=hash;
    if(!found){let lo=BigInt(review.observed.blockNumber),hi=head.number;requireReclaim(hi>=lo&&hi-lo<=256n);
      const nonce=BigInt(q.nonce);if(BigInt(await rpc.getTransactionCount({address:q.from,blockNumber:hi}))<=nonce)return{...base,status:"pending"};
      while(lo<hi){const middle=(lo+hi)/2n;if(BigInt(await rpc.getTransactionCount({address:q.from,blockNumber:middle}))>nonce)hi=middle;else lo=middle+1n;}
      const block=await rpc.getBlock({blockNumber:lo,includeTransactions:true});requireReclaim(block.transactions.length<=32);
      const matches=block.transactions.filter(t=>same(t.from,q.from)&&BigInt(t.nonce)===nonce);requireReclaim(matches.length===1);found=matches[0].hash;
    }
    const tx=await rpc.getTransaction({hash:found});requireReclaim(same(tx.hash,found)&&same(tx.from,q.from)&&same(tx.to!,q.to)&&same(tx.input,q.data)&&tx.value===0n&&tx.chainId===31337
      &&BigInt(tx.nonce)===BigInt(q.nonce)&&tx.type==="eip1559"&&!tx.authorizationList&&!tx.accessList?.length&&tx.gas===BigInt(q.gas)
      &&tx.maxFeePerGas===BigInt(q.maxFeePerGas)&&tx.maxPriorityFeePerGas===BigInt(q.maxPriorityFeePerGas));
    if(tx.blockNumber===null)return{...base,status:"pending",transactionHash:found};
    let receipt;try{receipt=await rpc.getTransactionReceipt({hash:found});}catch{return{...base,status:"pending",transactionHash:found,reason:"Receipt evidence unavailable; no duplicate submission is authorized"};}
    const block=await rpc.getBlock({blockNumber:receipt.blockNumber});requireReclaim(receipt.blockNumber>BigInt(review.observed.blockNumber)&&receipt.blockNumber===tx.blockNumber
      &&receipt.transactionIndex===tx.transactionIndex&&same(receipt.blockHash,tx.blockHash!)&&same(block.hash!,receipt.blockHash)&&same(receipt.transactionHash,found)
      &&same(block.transactions[receipt.transactionIndex]as Hex,found)&&same(receipt.from,q.from)&&same(receipt.to!,q.to)&&receipt.logs.length<=128
      &&new Set(receipt.logs.map(l=>l.logIndex)).size===receipt.logs.length&&receipt.logs.every(l=>!l.removed&&same(l.transactionHash,found!)&&same(l.blockHash,receipt.blockHash)&&l.blockNumber===receipt.blockNumber));
    const canonical=reclaimPoint(block as ReclaimHead);if(receipt.status==="reverted")return{...base,status:"reverted",transactionHash:found,canonical};
    requireReclaim(receipt.status==="success");if(head.number<receipt.blockNumber+2n)return{...base,status:"pending",transactionHash:found};
    requireReclaim(block.transactions.length===1,"Independent historical balance settlement requires a single-transaction fixture block");
    const proof=await readReclaimProof(config,rpc,review.campaign,head);requireReclaim(same(proof.runtimeHash,review.campaignRuntimeHash));
    const actorCode=await rpc.getCode({address:review.actor,blockNumber:receipt.blockNumber});requireReclaim(same(keccak256(actorCode??"0x"),review.actorCodeHash));
    if(review.kind==="metamask-7702"){const delegate=await rpc.getCode({address:claimDelegatePin.address,blockNumber:receipt.blockNumber});requireReclaim(same(actorCode!,claimDelegatePin.designator)&&delegate&&same(keccak256(delegate),claimDelegatePin.runtimeHash));}
    let settlement:ReclaimVerification["settlement"];
    const events=parseEventLogs({abi:reclaimCampaignAbi,logs:receipt.logs.filter(l=>same(l.address,review.campaign)),strict:true});
    if(review.operation==="create-campaign")requireReclaim(same(proof.deployment.transactionHash,found)&&same(proof.creator,review.actor)&&same(proof.initialController,review.fields.controller!)&&proof.initialRewardPerUnit===review.fields.rewardPerUnit&&proof.walletCap===review.fields.walletCap);
    else if(review.operation==="fund"||review.operation==="execute-recovery"){
      const expected=review.operation==="fund"?"Funded":"ReserveRecovered",event=events.filter(e=>e.eventName===expected);requireReclaim(event.length===1);
      const args=event[0].args as{controller:Address;amount:bigint};requireReclaim(args.amount===BigInt(review.rewardWei));
      await verifyTokenDelta(config,rpc,receipt,review.operation==="fund"?review.actor:review.campaign,review.operation==="fund"?review.campaign:args.controller,args.amount);
    }else if(review.operation==="redeem"||review.operation==="return"){
      const event=events.filter(e=>e.eventName===(review.operation==="redeem"?"TradeInAccepted":"TradeInReturned"));requireReclaim(event.length===1);
      const args=event[0].args as{receiptId:bigint;claimant:Address;collection?:Address;reward?:bigint;rewardRepaid?:bigint;ids?:readonly bigint[];quantities?:readonly bigint[]};
      const id=args.receiptId,r=await reclaimRead<readonly[Address,Address,number,bigint,bigint,number,number]>(rpc,review.campaign,reclaimCampaignAbi,"tradeIns",[id],receipt.blockNumber);
      const items=await reclaimRead<readonly[readonly bigint[],readonly bigint[]]>(rpc,review.campaign,reclaimCampaignAbi,"receiptItems",[id],receipt.blockNumber);
      requireReclaim(same(args.claimant,review.actor)&&same(r[0],review.actor)&&r[4]===BigInt(review.rewardWei)&&r[6]===(review.operation==="redeem"?1:2));
      if(review.operation==="redeem")requireReclaim(same(r[1],review.fields.collection!)&&JSON.stringify(items[0].map(String))===JSON.stringify(review.fields.tokenIds)&&JSON.stringify(items[1].map(String))===JSON.stringify(review.fields.quantities)&&args.reward===r[4]);
      else requireReclaim(id===BigInt(review.fields.receiptId!)&&args.rewardRepaid===r[4]);
      await verifyTokenDelta(config,rpc,receipt,review.operation==="redeem"?review.campaign:review.actor,review.operation==="redeem"?review.actor:review.campaign,r[4]);
      const asset=config.module.collections.find(a=>same(a.address,r[1]));requireReclaim(asset&&asset.standard===r[2]);
      const code=await rpc.getCode({address:asset.address,blockNumber:receipt.blockNumber});requireReclaim(code&&same(keccak256(code),asset.runtimeHash));
      const from=review.operation==="redeem"?review.actor:review.campaign,to=review.operation==="redeem"?review.campaign:review.actor;
      if(asset.standard===1){const transfers=parseEventLogs({abi:reclaim721Abi,eventName:"Transfer",logs:receipt.logs.filter(l=>same(l.address,asset.address)),strict:true});requireReclaim(transfers.length===items[0].length);
        for(const nftId of items[0]){const selected=transfers.filter(l=>l.args.tokenId===nftId&&same(l.args.from,from)&&same(l.args.to,to));requireReclaim(selected.length===1);
          const[before,after]=await Promise.all([reclaimRead<Address>(rpc,asset.address,reclaim721Abi,"ownerOf",[nftId],receipt.blockNumber-1n),reclaimRead<Address>(rpc,asset.address,reclaim721Abi,"ownerOf",[nftId],receipt.blockNumber)]);requireReclaim(same(before,from)&&same(after,to));}
      }else{const transfers=parseEventLogs({abi:reclaim1155Abi,eventName:"TransferBatch",logs:receipt.logs.filter(l=>same(l.address,asset.address)),strict:true});requireReclaim(transfers.length===1&&same(transfers[0].args.from,from)&&same(transfers[0].args.to,to));
        requireReclaim(JSON.stringify(transfers[0].args.ids.map(String))===JSON.stringify(items[0].map(String))&&JSON.stringify(transfers[0].args.values.map(String))===JSON.stringify(items[1].map(String)));
        for(let i=0;i<items[0].length;i++){const get=(account:Address,at:bigint)=>reclaimRead<bigint>(rpc,asset.address,reclaim1155Abi,"balanceOf",[account,items[0][i]],at);
          const[fb,fa,tb,ta]=await Promise.all([get(from,receipt.blockNumber-1n),get(from,receipt.blockNumber),get(to,receipt.blockNumber-1n),get(to,receipt.blockNumber)]);requireReclaim(fb>=fa&&fb-fa===items[1][i]&&ta>=tb&&ta-tb===items[1][i]);}
      }
      settlement={kind:review.operation==="redeem"?"trade-in":"return",receiptId:id.toString(),claimant:review.actor,collection:asset.address,tokenIds:items[0].map(String),quantities:items[1].map(String),rewardToken:config.module.rewardToken,rewardWei:r[4].toString(),custody:review.operation==="redeem"?"escrow":"returned",transactionHash:found,canonical};
    }else if(review.operation==="approve-funding"||review.operation==="approve-return"){
      const approvals=parseEventLogs({abi:erc20Abi,eventName:"Approval",logs:receipt.logs.filter(l=>same(l.address,config.module.rewardToken)),strict:true});requireReclaim(approvals.length===1&&same(approvals[0].args.owner,review.actor)&&same(approvals[0].args.spender,review.campaign)&&approvals[0].args.value===BigInt(review.rewardWei));
    }else if(review.operation==="approve-721"){
      const events=parseEventLogs({abi:reclaim721Abi,eventName:"Approval",logs:receipt.logs.filter(l=>same(l.address,review.fields.collection!)),strict:true});requireReclaim(events.length===1&&same(events[0].args.owner,review.actor)&&same(events[0].args.approved,review.campaign)&&events[0].args.tokenId===BigInt(review.fields.tokenId!));
    }else if(review.operation==="approve-1155"||review.operation==="revoke-1155"){
      const approvals=parseEventLogs({abi:reclaim1155Abi,eventName:"ApprovalForAll",logs:receipt.logs.filter(l=>same(l.address,review.fields.collection!)),strict:true});requireReclaim(approvals.length===1&&same(approvals[0].args.account,review.actor)&&same(approvals[0].args.operator,review.campaign)&&approvals[0].args.approved===(review.operation==="approve-1155"));
    }else requireReclaim(events.length>0);
    const snapshot=await readReclaimSnapshot(config,review.campaign,{rpc,head});
    return{...base,status:"confirmed",transactionHash:found,canonical,indexed:snapshot.history.indexed,snapshot,...(settlement&&{settlement})};
  }catch{return{...base,status:"unavailable",...(hash&&{transactionHash:hash}),reason:"Canonical Reclaim transaction, NFT custody, reward transfer or indexed evidence is unavailable; preserve the original request"};}
}

let active=0,minute=-1,calls=0;
function acquire(){const now=Math.floor(Date.now()/60_000);if(now!==minute){minute=now;calls=0;}if(active>=2||calls>=120)return null;active++;calls++;return()=>{active--;};}
export async function handleReclaimRead(request:Request){
  const config=configuredReclaimFixture(request.headers);
  if(!config||!["GET","HEAD"].includes(request.method))return reply({status:"unavailable",executionEnabled:false,reason:"No verified live Reclaim campaign, RMT token, reference policy or funded reserve is activated"});
  const url=new URL(request.url),campaign=url.searchParams.get("campaign");if(url.searchParams.size!==1||!reclaimAddress(campaign))return reply({status:"invalid",executionEnabled:false},400);
  const release=acquire();if(!release)return reply({status:"unavailable",executionEnabled:false},429);
  try{return reply(await readReclaimSnapshot(config,normalized(campaign)));}catch{return reply({status:"unavailable",executionEnabled:false});}finally{release();}
}
export async function handleReclaimTest(request:Request){
  const config=configuredReclaimFixture(request.headers);if(!config||request.method!=="POST")return reply({status:"unavailable",executionEnabled:false},404);
  const url=new URL(request.url),origin=new URL(config.curve.origin);
  if(url.protocol!=="http:"||!["localhost","127.0.0.1"].includes(url.hostname)||url.port!==origin.port||url.search||url.hash||request.headers.get("origin")!==config.curve.origin||request.headers.has("forwarded"))return reply({status:"invalid",executionEnabled:false},403);
  const length=request.headers.get("content-length");if(request.headers.get("content-type")?.split(";")[0]!=="application/json"||length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>65536))return reply({status:"invalid",executionEnabled:false},400);
  const release=acquire();if(!release)return reply({status:"unavailable",executionEnabled:false},429);
  let review:ReclaimReview|undefined;
  try{requireReclaim(request.body);const body=await readTreasuryBody(request.body,65536);
    if(body.action==="prepare"&&keys(body,["action","operation","account","fields"],["campaign"]))return reply(await prepareReclaim(config,body));
    if(body.action==="state"&&keys(body,["action","campaign"],["account"])&&reclaimAddress(body.campaign))return reply(await readReclaimSnapshot(config,normalized(body.campaign)));
    if(["verify","revalidate"].includes(String(body.action))&&keys(body,["action","review"],["transactionHash"])&&isReclaimReview(body.review)){
      review=body.review;if(body.action==="verify"){requireReclaim(body.transactionHash===undefined||reclaimHash(body.transactionHash));return reply(await verifyReclaimTransaction(config,review,body.transactionHash as Hex|undefined));}
      requireReclaim(body.transactionHash===undefined);const next=await prepareReclaim(config,{operation:review.operation,account:review.actor,campaign:review.campaign,fields:review.fields},review);
      return reply({status:next.reviewHash===review.reviewHash?"unchanged":"unavailable",reviewHash:review.reviewHash,executionEnabled:false});
    }return reply({status:"invalid",executionEnabled:false},400);
  }catch{return reply(review?{schemaVersion:1,profile:reclaimProfile,chainId:31337,executionEnabled:false,reviewHash:review.reviewHash,status:"unavailable",finality:"synthetic-local-not-production",reason:"Reclaim review or canonical settlement unavailable"}:{status:"unavailable",executionEnabled:false,reason:"Reclaim identity, ownership, eligibility, reserve or simulation is unavailable"});}
  finally{release();}
}
