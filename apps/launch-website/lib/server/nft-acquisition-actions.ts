import {decodeFunctionData,encodeFunctionData,erc20Abi,getAddress,isAddress,hashTypedData,keccak256,parseAbi,parseEventLogs,recoverTypedDataAddress,toHex,zeroAddress,type Address,type Hex} from "viem";
import {nftAcquisitionOrderTypes} from "../../../../packages/launchpad-common/nft-acquisition-runtime.mjs";
import {resolveNftCollection} from "../../../../packages/launchpad-common/nft-collection-resolver.mjs";
import {claimProfileDigest,claimDelegatePin} from "../claim-profiles";
import {isNftAcquisitionReview,nftAcquisitionOperations,nftAcquisitionProfile,nftAcquisitionReviewHash,nftAddress,nftHash,nftUint,sameNftHex as same,validNftFields,type NftAcquisitionFields,type NftAcquisitionOperation,type NftAcquisitionReview,type NftAcquisitionVerification} from "../nft-acquisition";
import {configuredNftAcquisitionFixture,verifyNftAcquisitionContext,nftAcquisitionPoint,readNftAcquisitionSnapshot,nftRead,nftVaultAbi,nftVenueAbi,nft721Abi,nft1155Abi,normalizeNft,requireNft,type NftAcquisitionFixture,type NftAcquisitionRpc,type NftAcquisitionHead} from "./nft-acquisition-fixture";
import {projectTreasuryControllerKind} from "./project-treasury-fixture";
import {readTreasuryBody} from "./project-treasury-actions";
import {nftAcquisitionOperationFields} from "../nft-acquisition-calldata";

const liveAddresses=new Set(["0x7e8e7d3af28584a8b9eeddbe16cd3308bd1e76ca","0xc447a378cfd8460febc2eef67501d7a5473b9001","0xc3600f2df60929d2ab9ab294cff42eedcb984f51","0x2bcc3fafce77ccc7fdbed46e0b5bb80ba3e76697","0xaf9f10258b091719618c19d057f9cdab72effd8b","0x8d44078642ce938fd799b23087bcdd6114a302e5"]);
export const syntheticNftActor=(v:unknown):v is Address=>nftAddress(v)&&!liveAddresses.has(v.toLowerCase());
const call=(name:string,args:readonly unknown[]=[])=>encodeFunctionData({abi:nftVaultAbi,functionName:name,args}as never);
const allowedFields=nftAcquisitionOperationFields;
const exact=(v:Record<string,unknown>,required:readonly string[],optional:readonly string[]=[])=>required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const numberField=(f:NftAcquisitionFields,name:string)=>{requireNft(nftUint(f[name]),`Invalid ${name}`);return BigInt(f[name]as string);};
const addressField=(f:NftAcquisitionFields,name:string,zero=false)=>{requireNft(nftAddress(f[name])||zero&&f[name]===zeroAddress,`Invalid ${name}`);return normalizeNft(f[name]as string);};
type Order={seller:Address;vault:Address;collection:Address;standard:number;tokenId:bigint;quantity:bigint;currency:Address;sellerAmount:bigint;feeRecipient:Address;feeAmount:bigint;royaltyRecipient:Address;royaltyAmount:bigint;startTime:number;endTime:number;sellerNonce:bigint;salt:Hex};
export function parseNftAcquisitionOrder(value:unknown):Order{
  requireNft(typeof value==="string"&&value.length<=8192);const raw=JSON.parse(value)as Record<string,unknown>;
  const addresses=["seller","vault","collection","currency","feeRecipient","royaltyRecipient"],uints=["tokenId","quantity","sellerAmount","feeAmount","royaltyAmount","sellerNonce"];
  requireNft(exact(raw,[...addresses,...uints,"standard","startTime","endTime","salt"])&&addresses.every(k=>typeof raw[k]==="string"&&/^0x[0-9a-f]{40}$/i.test(raw[k]as string))&&uints.every(k=>nftUint(raw[k]))&&[1,2].includes(raw.standard as number)&&nftHash(raw.salt)
    &&[raw.startTime,raw.endTime].every(n=>Number.isSafeInteger(n)&&(n as number)>=0&&(n as number)<2**48));
  return{...raw,...Object.fromEntries(addresses.map(k=>[k,normalizeNft(raw[k]as string)])),...Object.fromEntries(uints.map(k=>[k,BigInt(raw[k]as string)]))}as Order;
}
export async function nftAcquisitionTerms(config:NftAcquisitionFixture,rpc:NftAcquisitionRpc,head:NftAcquisitionHead,actor:Address,operation:NftAcquisitionOperation,fields:NftAcquisitionFields,prior?:NftAcquisitionReview){
  const m=config.module,get=<T>(fn:string,args:readonly unknown[]=[])=>nftRead<T>(rpc,m.vault,nftVaultAbi,fn,args,head.number);
  requireNft(validNftFields(fields)&&exact(fields,allowedFields[operation]));
  const[controller,ce,pe]=await Promise.all([get<Address>("controller"),get<bigint>("controllerEpoch"),get<bigint>("policyEpoch")]);
  const funding=["fund-native","approve-funding","fund-token"].includes(operation),incoming=operation==="accept-controller";
  requireNft(funding||incoming||same(controller,actor),"Only the actual on-chain controller can prepare this action");
  const expiresAt=prior?.expiresAt??Number(head.timestamp)+180;requireNft(BigInt(expiresAt)>head.timestamp&&BigInt(expiresAt)<=head.timestamp+600n);
  let data:Hex,target=m.vault,targetRuntimeHash=m.vaultRuntimeHash,value:Hex="0x0",listing:NftAcquisitionReview["listing"]=null;
  if(operation==="fund-native"){const amount=numberField(fields,"amountWei");requireNft(amount>0n&&amount<=100n*10n**18n&&nftHash(fields.source));value=toHex(amount);data=call("fundNative",[fields.source]);}
  else if(operation==="approve-funding"){const amount=numberField(fields,"amountWei");requireNft(amount>0n&&amount<=100n*10n**18n);target=m.paymentToken;targetRuntimeHash=m.paymentTokenRuntimeHash;data=encodeFunctionData({abi:erc20Abi,functionName:"approve",args:[m.vault,amount]});}
  else if(operation==="fund-token"){const amount=numberField(fields,"amountWei");requireNft(amount>0n&&nftHash(fields.source));data=call("fundToken",[amount,fields.source]);}
  else if(operation==="configure"){const currency=addressField(fields,"currency",true);requireNft(currency===zeroAddress||same(currency,m.paymentToken));const caps=["perNftCap","totalBudget","periodBudget"].map(k=>numberField(fields,k)),cooldown=numberField(fields,"cooldownSeconds");requireNft(caps.every(n=>n>0n&&n<2n**128n)&&cooldown<2n**32n&&typeof fields.enabled==="boolean");data=call("configurePolicy",[{currency,perNftCap:caps[0],totalBudget:caps[1],periodBudget:caps[2],cooldownSeconds:Number(cooldown)},fields.enabled]);}
  else if(operation==="configure-collection"){
    const collection=addressField(fields,"collection"),c=m.collections.find(v=>same(v.address,collection));requireNft(c&&fields.identityConfirmed===true&&typeof fields.enabled==="boolean"&&typeof fields.anyTokenId==="boolean"&&typeof fields.ids==="string");
    const ids=fields.ids===""?[]:fields.ids.split(",");requireNft(ids.length<=32&&ids.every(nftUint)&&ids.every((id,i)=>i===0||BigInt(id)>BigInt(ids[i-1]))&&(fields.anyTokenId===true?ids.length===0:fields.enabled===false||ids.length>0));
    data=call("configureCollection",[collection,c.standard===721?1:2,c.runtimeHash,fields.enabled,fields.anyTokenId,ids.map(BigInt)]);
  }else if(operation==="disable")data=call("disablePurchases");
  else if(operation==="buy"){
    requireNft(fields.identityConfirmed===true&&typeof fields.signature==="string"&&/^0x[0-9a-f]{130}$/i.test(fields.signature));const o=parseNftAcquisitionOrder(fields.order),asset=m.collections.find(c=>same(c.address,o.collection));
    requireNft(asset&&same(o.vault,m.vault)&&o.standard===(asset.standard===721?1:2)&&syntheticNftActor(o.seller)&&(o.currency===zeroAddress||same(o.currency,m.paymentToken))&&o.quantity>0n&&o.quantity<=20n&&o.startTime<=Number(head.timestamp)&&o.endTime>=expiresAt&&o.endTime<=Number(head.timestamp)+86400);
    const typed={domain:{name:"RMT Synthetic NFT Listing Venue",version:"1",chainId:31337,verifyingContract:m.venue},types:nftAcquisitionOrderTypes,primaryType:"Order",message:o}as const;
    const hash=hashTypedData(typed as never);requireNft(same(await recoverTypedDataAddress({...typed,signature:fields.signature}as never),o.seller)&&same(await nftRead<Hex>(rpc,m.venue,nftVenueAbi,"orderHash",[o],head.number),hash));
    requireNft(await nftRead<number>(rpc,m.venue,nftVenueAbi,"orderState",[hash],head.number)===0&&await nftRead<bigint>(rpc,m.venue,nftVenueAbi,"sellerNonces",[o.seller],head.number)===o.sellerNonce);
    const approved=await nftRead<boolean>(rpc,o.collection,o.standard===1?nft721Abi:nft1155Abi,"isApprovedForAll",[o.seller,m.venue],head.number);
    if(o.standard===1){requireNft(same(await nftRead<Address>(rpc,o.collection,nft721Abi,"ownerOf",[o.tokenId],head.number),o.seller)&&(approved||same(await nftRead<Address>(rpc,o.collection,nft721Abi,"getApproved",[o.tokenId],head.number),m.venue)));}
    else requireNft(approved&&await nftRead<bigint>(rpc,o.collection,nft1155Abi,"balanceOf",[o.seller,o.tokenId],head.number)>=o.quantity);
    const total=o.sellerAmount+o.feeAmount+o.royaltyAmount;requireNft(total>0n);
    data=call("purchase",[o,fields.signature,pe,ce,expiresAt]);listing={orderHash:hash,collection:o.collection,standard:asset.standard,tokenId:String(o.tokenId),quantity:String(o.quantity),seller:o.seller,paymentAsset:o.currency,allInWei:String(total),venue:m.venue,venueRuntimeHash:m.venueRuntimeHash,expiry:String(o.endTime),custody:m.vault,listingVerified:true,route:"synthetic-local-nondeployable"};
  }else if(operation==="schedule-controller"){const next=addressField(fields,"incoming"),expiry=numberField(fields,"expiresAt");requireNft(syntheticNftActor(next)&&!same(next,controller)&&["eoa","metamask-7702","safe-1.4.1"].includes(await projectTreasuryControllerKind(rpc,next,head.number)));data=call("proposeController",[next,expiry]);}
  else if(operation==="cancel-controller")data=call("cancelController");
  else if(operation==="accept-controller"){const pending=await get<readonly[Address,number,number,bigint]>("pendingController");requireNft(same(pending[0],actor)&&BigInt(pending[1])<=head.timestamp&&BigInt(pending[2])>=head.timestamp&&pending[3]===ce);data=call("acceptController");}
  else if(operation==="schedule-nft-withdrawal"){const collection=addressField(fields,"collection");requireNft(m.collections.some(c=>same(c.address,collection)));data=call("scheduleNftWithdrawal",[collection,numberField(fields,"tokenId"),numberField(fields,"quantity"),addressField(fields,"recipient"),numberField(fields,"expiresAt")]);}
  else if(operation==="schedule-asset-withdrawal")data=call("scheduleAssetWithdrawal",[addressField(fields,"currency",true),numberField(fields,"amountWei"),addressField(fields,"recipient"),numberField(fields,"expiresAt")]);
  else if(operation==="execute-withdrawal")data=call("executeWithdrawal",[numberField(fields,"id")]);
  else{requireNft(operation==="cancel-withdrawal");data=call("cancelWithdrawal",[numberField(fields,"id")]);}
  return{data,target,targetRuntimeHash,value,listing,controller,controllerEpoch:String(ce),policyEpoch:String(pe),expiresAt};
}
export async function prepareNftAcquisition(config:NftAcquisitionFixture,body:Record<string,unknown>,prior?:NftAcquisitionReview):Promise<NftAcquisitionReview>{
  requireNft(syntheticNftActor(body.account)&&nftAcquisitionOperations.includes(body.operation as NftAcquisitionOperation)&&validNftFields(body.fields));
  const{rpc,head}=await verifyNftAcquisitionContext(config),actor=normalizeNft(body.account),operation=body.operation as NftAcquisitionOperation;
  const terms=await nftAcquisitionTerms(config,rpc,head,actor,operation,body.fields,prior),kind=await projectTreasuryControllerKind(rpc,actor,head.number);requireNft(kind!=="unsupported");
  const code=await rpc.getCode({address:actor,blockNumber:head.number}),pendingCode=await rpc.getCode({address:actor,blockTag:"pending"});requireNft(same(code??"0x",pendingCode??"0x"));
  let request:NftAcquisitionReview["request"]=null,maximum="0";
  const innerCall={from:actor,to:terms.target,data:terms.data,value:terms.value};
  // Read-only simulation from a Safe tests target terms, not ownership. Two
  // actual owner signatures and the full outer simulation remain mandatory.
  await rpc.call({account:actor,to:terms.target,data:terms.data,value:BigInt(terms.value),blockNumber:head.number});
  if(kind!=="safe-1.4.1"){
    const[estimate,priority,block,nonce]=await Promise.all([rpc.estimateGas({account:actor,to:terms.target,data:terms.data,value:BigInt(terms.value),blockNumber:head.number}),rpc.estimateMaxPriorityFeePerGas(),rpc.getBlock(),rpc.getTransactionCount({address:actor,blockTag:"pending"})]);
    const gas=estimate*125n/100n,fee=(block.baseFeePerGas??0n)*2n+priority;requireNft(gas>0n&&gas<=20_000_000n&&fee>0n);
    request={type:"0x2",chainId:"0x7a69",from:actor,to:terms.target,data:terms.data,value:terms.value,nonce:toHex(nonce),gas:toHex(gas),maxFeePerGas:toHex(fee),maxPriorityFeePerGas:toHex(priority)};
    if(prior){requireNft(prior.request&&same(prior.request.data,terms.data)&&prior.request.value===terms.value&&BigInt(prior.request.nonce)===BigInt(nonce)&&estimate<=BigInt(prior.request.gas)&&(block.baseFeePerGas??0n)+priority<=BigInt(prior.request.maxFeePerGas));request=prior.request;}
    maximum=String(BigInt(request.gas)*BigInt(request.maxFeePerGas));requireNft(await rpc.getBalance({address:actor,blockTag:"pending"})>=BigInt(maximum)+BigInt(terms.value));
  }else requireNft(terms.value==="0x0","Safe funding requires a separately reviewed value-bearing profile; no unsupported value call is prepared");
  const partial:Omit<NftAcquisitionReview,"reviewHash">={schemaVersion:1,profile:nftAcquisitionProfile,chainId:31337,scope:"isolated-local",executionEnabled:false,status:kind==="safe-1.4.1"?"needs-safe-approvals":"prepared",operation,actor,controller:terms.controller,controllerEpoch:terms.controllerEpoch,policyEpoch:terms.policyEpoch,kind:kind==="safe-1.4.1"?"safe-inner":kind,vault:config.module.vault,targetRuntimeHash:terms.targetRuntimeHash,actorCodeHash:keccak256(code??"0x"),fields:body.fields,innerCall,request,observed:prior?.observed??nftAcquisitionPoint(head),expiresAt:terms.expiresAt,maximumNetworkFeeWei:maximum,listing:terms.listing,
    notices:["Synthetic local transaction only. Production execution is blocked.","No automatic wallet prompts or resubmission. Manual settled funding does not redirect immutable fee credits.",...(kind==="safe-1.4.1"?["Safe signatures have nonce-only replay protection; an application expiry cannot revoke signed administrative calldata."]:[])]};
  const review={...partial,reviewHash:nftAcquisitionReviewHash(partial)};requireNft(isNftAcquisitionReview(review));if(prior)requireNft(review.reviewHash===prior.reviewHash&&same((await rpc.getBlock({blockNumber:BigInt(prior.observed.blockNumber)})).hash!,prior.observed.blockHash));return review;
}
/** A receipt-shaped provider object is not enough: every envelope, membership
 * and log identity must bind the original sender/nonce and canonical block. */
export function assertNftAcquisitionEnvelope(q:NonNullable<NftAcquisitionReview["request"]>,tx:Awaited<ReturnType<NftAcquisitionRpc["getTransaction"]>>,receipt:Awaited<ReturnType<NftAcquisitionRpc["getTransactionReceipt"]>>,block:Awaited<ReturnType<NftAcquisitionRpc["getBlock"]>>,anchor:bigint,found:Hex):void{
  requireNft(tx.type==="eip1559"&&!tx.authorizationList&&!tx.accessList?.length&&tx.chainId===31337&&same(tx.hash,found)&&same(tx.from,q.from)&&tx.to!==null&&same(tx.to,q.to)
    &&tx.value===BigInt(q.value)&&same(tx.input,q.data)&&BigInt(tx.nonce)===BigInt(q.nonce)&&tx.gas===BigInt(q.gas)&&tx.maxFeePerGas===BigInt(q.maxFeePerGas)&&tx.maxPriorityFeePerGas===BigInt(q.maxPriorityFeePerGas)
    &&["success","reverted"].includes(receipt.status)&&receipt.type==="eip1559"&&receipt.blockNumber>anchor&&receipt.blockNumber===tx.blockNumber&&block.number===receipt.blockNumber
    &&Number.isSafeInteger(receipt.transactionIndex)&&receipt.transactionIndex>=0&&receipt.transactionIndex===tx.transactionIndex&&receipt.transactionIndex<block.transactions.length
    &&same(block.hash!,receipt.blockHash)&&same(tx.blockHash!,receipt.blockHash)&&same(receipt.transactionHash,found)&&same(block.transactions[receipt.transactionIndex]as Hex,found)
    &&same(receipt.from,q.from)&&receipt.to!==null&&same(receipt.to,q.to)&&receipt.gasUsed>0n&&receipt.gasUsed<=tx.gas&&receipt.effectiveGasPrice>=0n&&receipt.effectiveGasPrice<=BigInt(q.maxFeePerGas)
    &&Array.isArray(receipt.logs)&&receipt.logs.length<=256&&new Set(receipt.logs.map(l=>l.logIndex)).size===receipt.logs.length
    &&receipt.logs.every(l=>!l.removed&&Number.isSafeInteger(l.logIndex)&&l.logIndex>=0&&l.transactionIndex===receipt.transactionIndex&&nftAddress(l.address)
      &&same(l.blockHash,receipt.blockHash)&&same(l.transactionHash,found)&&l.blockNumber===receipt.blockNumber&&/^0x(?:[0-9a-f]{2}){0,32768}$/i.test(l.data)
      &&l.topics.length<=4&&l.topics.every(t=>/^0x[0-9a-f]{64}$/i.test(t))));
}
export async function verifyNftAcquisitionTransaction(config:NftAcquisitionFixture,review:NftAcquisitionReview,hash?:Hex,outer?:{request:NonNullable<NftAcquisitionReview["request"]>;verifyOrigin:(rpc:NftAcquisitionRpc,receipt:Awaited<ReturnType<NftAcquisitionRpc["getTransactionReceipt"]>>)=>Promise<void>}):Promise<NftAcquisitionVerification>{
  const base={schemaVersion:1,profile:nftAcquisitionProfile,chainId:31337,executionEnabled:false,reviewHash:review.reviewHash,finality:"synthetic-local-not-production"}as const;
  try{requireNft(isNftAcquisitionReview(review)&&same(review.vault,config.module.vault)&&syntheticNftActor(review.actor)&&(review.kind==="safe-inner")===Boolean(outer));const{rpc,head}=await verifyNftAcquisitionContext(config),q=outer?.request??review.request;requireNft(q);
    let found=hash;if(!found){const from=BigInt(review.observed.blockNumber);requireNft(head.number-from<=256n);const candidates:Hex[]=[];
      for(let n=from;n<=head.number;n++){const block=await rpc.getBlock({blockNumber:n,includeTransactions:true});for(const tx of block.transactions){requireNft(typeof tx!=="string");if(same(tx.from,q.from)&&BigInt(tx.nonce)===BigInt(q.nonce))candidates.push(tx.hash);}}requireNft(candidates.length<=1);found=candidates[0];}
    if(!found)return{...base,status:"pending",reason:"Original sender/nonce is not yet canonically observed. No resubmission."};
    const anchor=await rpc.getBlock({blockNumber:BigInt(review.observed.blockNumber)});requireNft(anchor.number!==null&&anchor.hash&&same(anchor.hash,review.observed.blockHash));
    const original=await nftAcquisitionTerms(config,rpc,anchor as NftAcquisitionHead,review.actor,review.operation,review.fields,review);
    requireNft(same(original.target,review.innerCall.to)&&same(original.data,review.innerCall.data)&&original.value===review.innerCall.value&&same(original.targetRuntimeHash,review.targetRuntimeHash)
      &&same(original.controller,review.controller)&&original.controllerEpoch===review.controllerEpoch&&original.policyEpoch===review.policyEpoch&&claimProfileDigest(original.listing)===claimProfileDigest(review.listing));
    const[tx,receipt]=await Promise.all([rpc.getTransaction({hash:found}),rpc.getTransactionReceipt({hash:found})]);
    const block=await rpc.getBlock({blockNumber:receipt.blockNumber});assertNftAcquisitionEnvelope(q,tx,receipt,block,BigInt(review.observed.blockNumber),found);
    const canonical=nftAcquisitionPoint(block as NftAcquisitionHead);if(receipt.status==="reverted")return{...base,status:"reverted",transactionHash:found,canonical};
    if(outer)await outer.verifyOrigin(rpc,receipt);else{const code=await rpc.getCode({address:review.actor,blockNumber:receipt.blockNumber});requireNft(same(keccak256(code??"0x"),review.actorCodeHash)&&["eoa","metamask-7702"].includes(await projectTreasuryControllerKind(rpc,review.actor,receipt.blockNumber)));
      if(review.kind==="metamask-7702"){const pin=await rpc.getCode({address:claimDelegatePin.address,blockNumber:receipt.blockNumber});requireNft(pin&&same(keccak256(pin),claimDelegatePin.runtimeHash));}}
    const targetCode=await rpc.getCode({address:review.innerCall.to,blockNumber:receipt.blockNumber});requireNft(targetCode&&same(keccak256(targetCode),review.targetRuntimeHash));
    let settlement:NftAcquisitionVerification["settlement"];
    if(review.operation==="buy"){
      requireNft(review.listing);const proof=await import("../../../../packages/launchpad-common/nft-acquisition-proof.mjs");
      const o=parseNftAcquisitionOrder(review.fields.order),l=review.listing,m=config.module;
      const typed={domain:{name:"RMT Synthetic NFT Listing Venue",version:"1",chainId:31337,verifyingContract:m.venue},types:nftAcquisitionOrderTypes,primaryType:"Order",message:o}as const;
      requireNft(same(hashTypedData(typed as never),l.orderHash)&&same(await recoverTypedDataAddress({...typed,signature:review.fields.signature}as never),o.seller)
        &&same(o.vault,review.vault)&&same(o.collection,l.collection)&&String(o.tokenId)===l.tokenId&&String(o.quantity)===l.quantity&&same(o.currency,l.paymentAsset)
        &&String(o.sellerAmount+o.feeAmount+o.royaltyAmount)===l.allInWei&&same(o.seller,l.seller)&&o.endTime>=Number(block.timestamp)&&o.startTime<=Number(block.timestamp)
        &&same(call("purchase",[o,review.fields.signature,BigInt(review.policyEpoch),BigInt(review.controllerEpoch),review.expiresAt]),review.innerCall.data));
      const events=parseEventLogs({abi:nftVaultAbi,eventName:"PurchaseExecuted",logs:receipt.logs.filter(e=>same(e.address,review.vault)),strict:true});
      const fills=parseEventLogs({abi:nftVenueAbi,eventName:"OrderFilled",logs:receipt.logs.filter(e=>same(e.address,m.venue)),strict:true});
      requireNft(events.length===1&&fills.length===1);const e=events[0].args as unknown as {orderHash:Hex;seller:Address;collection:Address;tokenId:bigint;quantity:bigint;currency:Address;totalCost:bigint;sellerAmount:bigint;feeRecipient:Address;feeAmount:bigint;royaltyRecipient:Address;royaltyAmount:bigint;controllerEpoch:bigint;policyEpoch:bigint},f=fills[0].args as unknown as {orderHash:Hex;vault:Address;seller:Address;collection:Address;tokenId:bigint;quantity:bigint;currency:Address;totalCost:bigint};
      requireNft(same(e.orderHash,l.orderHash)&&same(e.seller,o.seller)&&same(e.collection,o.collection)&&e.tokenId===o.tokenId&&e.quantity===o.quantity&&same(e.currency,o.currency)&&e.totalCost===BigInt(l.allInWei)
        &&e.sellerAmount===o.sellerAmount&&e.feeAmount===o.feeAmount&&e.royaltyAmount===o.royaltyAmount&&same(e.feeRecipient,o.feeRecipient)&&same(e.royaltyRecipient,o.royaltyRecipient)
        &&e.controllerEpoch===BigInt(review.controllerEpoch)&&e.policyEpoch===BigInt(review.policyEpoch)&&same(f.orderHash,l.orderHash)&&same(f.vault,review.vault)&&same(f.seller,o.seller)&&same(f.collection,o.collection)&&f.tokenId===o.tokenId&&f.quantity===o.quantity&&same(f.currency,o.currency)&&f.totalCost===e.totalCost);
      const collection=config.module.collections.find(c=>same(c.address,o.collection));requireNft(collection&&collection.standard===(o.standard===1?721:1155));
      const code=await rpc.getCode({address:o.collection,blockNumber:receipt.blockNumber});requireNft(code&&same(keccak256(code),collection.runtimeHash));
      let nftTransferInput:Hex;
      if(o.standard===1){const transfer=parseEventLogs({abi:nft721Abi,eventName:"Transfer",logs:receipt.logs.filter(e=>same(e.address,o.collection)),strict:true}).filter(t=>t.args.tokenId===o.tokenId);
        requireNft(transfer.length===1&&same(transfer[0].args.from,o.seller)&&same(transfer[0].args.to,review.vault)&&o.quantity===1n);
        nftTransferInput=encodeFunctionData({abi:parseAbi(["function safeTransferFrom(address,address,uint256)"]),functionName:"safeTransferFrom",args:[o.seller,review.vault,o.tokenId]});
      }else{const transfer=parseEventLogs({abi:nft1155Abi,eventName:"TransferSingle",logs:receipt.logs.filter(e=>same(e.address,o.collection)),strict:true}).filter(t=>t.args.id===o.tokenId);
        requireNft(transfer.length===1&&same(transfer[0].args.operator,m.venue)&&same(transfer[0].args.from,o.seller)&&same(transfer[0].args.to,review.vault)&&transfer[0].args.value===o.quantity);
        nftTransferInput=encodeFunctionData({abi:parseAbi(["function safeTransferFrom(address,address,uint256,uint256,bytes)"]),functionName:"safeTransferFrom",args:[o.seller,review.vault,o.tokenId,o.quantity,"0x"]});}
      const payments=[{recipient:o.seller,amount:o.sellerAmount},{recipient:o.feeRecipient,amount:o.feeAmount},{recipient:o.royaltyRecipient,amount:o.royaltyAmount}].filter(p=>p.amount>0n);
      if(o.currency!==zeroAddress){const transfers=parseEventLogs({abi:erc20Abi,eventName:"Transfer",logs:receipt.logs.filter(e=>same(e.address,o.currency)),strict:true});
        requireNft(transfers.length===payments.length&&payments.every((p,i)=>same(transfers[i].args.from,review.vault)&&same(transfers[i].args.to,p.recipient)&&transfers[i].args.value===p.amount));
        const allowance=await nftRead<bigint>(rpc,o.currency,erc20Abi,"allowance",[review.vault,m.venue],receipt.blockNumber);requireNft(allowance===0n);}
      let trace:unknown;try{trace=await rpc.request({method:"debug_traceTransaction",params:[found,{tracer:"callTracer"}]}as never);}catch{return{...base,status:"pending",transactionHash:found,canonical,reason:"Receipt observed, but exact payment/custody call trace is unavailable. Settlement remains pending."};}
      proof.assertNftAcquisitionTrace(trace,{from:q.from,to:q.to,input:q.data,value:BigInt(q.value)},
        {vault:review.vault,venue:m.venue,collection:o.collection,purchaseInput:review.innerCall.data,fillInput:encodeFunctionData({abi:nftVenueAbi,functionName:"fill",args:[o,review.fields.signature]}as never),
          nftTransferInput,totalCost:BigInt(l.allInWei),native:o.currency===zeroAddress,payments,...(outer&&{safeSingleton:"0x29fcB43b46531BcA003ddC8FCB67FFE91900C762"as Address})});
      settlement={orderHash:review.listing.orderHash,collection:review.listing.collection,tokenId:review.listing.tokenId,quantity:review.listing.quantity,custody:review.vault,paidWei:review.listing.allInWei,paymentAsset:review.listing.paymentAsset};
    }else{
      const decoded=decodeFunctionData({abi:same(review.innerCall.to,config.module.paymentToken)?erc20Abi:nftVaultAbi,data:review.innerCall.data});
      requireNft(same(encodeFunctionData({abi:same(review.innerCall.to,config.module.paymentToken)?erc20Abi:nftVaultAbi,functionName:decoded.functionName,args:decoded.args}as never),review.innerCall.data));
      const logs=parseEventLogs({abi:same(review.innerCall.to,config.module.paymentToken)?erc20Abi:nftVaultAbi,logs:receipt.logs.filter(l=>same(l.address,review.innerCall.to)),strict:true});requireNft(logs.length>0);
    }
    const snapshot=await readNftAcquisitionSnapshot(config,{rpc,head});return{...base,status:"confirmed",transactionHash:found,canonical,indexed:snapshot.history.indexed,snapshot,...(settlement&&{settlement})};
  }catch{return{...base,status:"unavailable",...(hash&&{transactionHash:hash}),reason:"Original transaction, canonical receipt, exact payment or NFT custody proof is unavailable. Preserve the original request; do not resubmit."};}
}
const responseHeaders={"Cache-Control":"private, no-store","Netlify-CDN-Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow"};
const reply=(body:object,status=200)=>Response.json(body,{status,headers:responseHeaders});let active=0,minute=-1,calls=0;
function acquire(){const now=Math.floor(Date.now()/60_000);if(now!==minute){minute=now;calls=0;}if(active>=2||calls>=120)return null;active++;calls++;return()=>{active--;};}
export async function handleNftAcquisitionRead(request:Request){const config=configuredNftAcquisitionFixture(request.headers);if(!config)return reply({status:"unavailable",executionEnabled:false},404);
  if(new URL(request.url).search)return reply({status:"invalid",executionEnabled:false},400);const release=acquire();if(!release)return reply({status:"unavailable",executionEnabled:false},429);try{return reply(await readNftAcquisitionSnapshot(config));}catch{return reply({status:"unavailable",executionEnabled:false});}finally{release();}}
export async function handleNftAcquisitionTest(request:Request){const config=configuredNftAcquisitionFixture(request.headers);if(!config||request.method!=="POST")return reply({status:"unavailable",executionEnabled:false},404);
  const url=new URL(request.url);if(url.origin!==config.curve.origin||url.search||url.hash||request.headers.get("origin")!==config.curve.origin||request.headers.has("forwarded"))return reply({status:"invalid",executionEnabled:false},403);
  const length=request.headers.get("content-length");if(request.headers.get("content-type")?.split(";")[0]!=="application/json"||length!==null&&(!/^\d+$/.test(length)||Number(length)>65536))return reply({status:"invalid",executionEnabled:false},400);
  const release=acquire();if(!release)return reply({status:"unavailable",executionEnabled:false},429);
  try{requireNft(request.body);const body=await readTreasuryBody(request.body,65536);
    if(body.action==="resolve"&&exact(body,["action","input"])){const{rpc,head}=await verifyNftAcquisitionContext(config),m=config.module;
      return reply(await resolveNftCollection(body.input,{chainId:31337,codecs:{getAddress,isAddress,keccak256},rpc:rpc as never,paymentAsset:zeroAddress,allowedCurrencies:[zeroAddress,m.paymentToken],nowMs:Number(head.timestamp)*1000,
        trustedCollectionHint:async slug=>{const c=m.collections.filter(v=>v.slug===slug);return{slug,name:c[0]?.name,contracts:c.map(v=>({address:v.address,chainId:31337,standard:v.standard}))};},
        verifiedSource:async({address,runtimeHash})=>{const c=m.collections.find(v=>same(v.address,address)&&same(v.runtimeHash,runtimeHash));return c?{verified:true,chainId:31337,address:c.address,runtimeHash:c.runtimeHash,standard:c.standard,sourceInputSha256:c.sourceInputSha256,proxy:false}:null;}}));}
    if(body.action==="prepare"&&exact(body,["action","operation","account","fields"]))return reply(await prepareNftAcquisition(config,body));
    if(body.action==="revalidate"&&exact(body,["action","review"])&&isNftAcquisitionReview(body.review)){const r=body.review,next=await prepareNftAcquisition(config,{operation:r.operation,account:r.actor,fields:r.fields},r);return reply({status:next.reviewHash===r.reviewHash?"unchanged":"unavailable",reviewHash:r.reviewHash,executionEnabled:false});}
    if(body.action==="verify"&&exact(body,["action","review"],["transactionHash"])&&isNftAcquisitionReview(body.review)){requireNft(body.transactionHash===undefined||nftHash(body.transactionHash));return reply(await verifyNftAcquisitionTransaction(config,body.review,body.transactionHash as Hex|undefined));}
    if(String(body.action).startsWith("safe-")){const safe=await import("./nft-acquisition-safe-actions"),types=await import("../nft-acquisition-safe");
      if(body.action==="safe-propose"&&exact(body,["action","review","gasPayer"])&&isNftAcquisitionReview(body.review))return reply(await safe.proposeNftAcquisitionSafe(config,body.review,body.gasPayer));
      if(body.action==="safe-approve"&&exact(body,["action","proposal","approval"])&&types.isNftAcquisitionSafeProposal(body.proposal))return reply(await safe.validateNftAcquisitionSafeApproval(config,body.proposal,body.approval as never));
      if(body.action==="safe-prepare"&&exact(body,["action","proposal","approvals"])&&types.isNftAcquisitionSafeProposal(body.proposal)&&Array.isArray(body.approvals))return reply(await safe.prepareNftAcquisitionSafeOuter(config,body.proposal,body.approvals as never));
      if(body.action==="safe-revalidate"&&exact(body,["action","review"])&&types.isNftAcquisitionSafeOuterReview(body.review)){const r=body.review,next=await safe.prepareNftAcquisitionSafeOuter(config,r.proposal,r.approvals,r);return reply({status:next.reviewHash===r.reviewHash?"unchanged":"unavailable",reviewHash:r.reviewHash,executionEnabled:false});}
      if(body.action==="safe-verify"&&exact(body,["action","review"],["transactionHash"])&&types.isNftAcquisitionSafeOuterReview(body.review)){requireNft(body.transactionHash===undefined||nftHash(body.transactionHash));return reply(await safe.verifyNftAcquisitionSafeOuter(config,body.review,body.transactionHash as Hex|undefined));}}
    return reply({status:"invalid",executionEnabled:false},400);
  }catch{return reply({status:"unavailable",executionEnabled:false,reason:"NFT acquisition identity, authority, order, funding or simulation is unavailable"});}finally{release();}}
