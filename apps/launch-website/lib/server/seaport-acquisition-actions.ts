import {NextResponse} from "next/server";
import {decodeFunctionData,encodeFunctionData,zeroAddress,zeroHash,type Hash,type PublicClient} from "viem";
import {configuredSeaportAcquisition,prepareSeaportAcquisition,readSeaportIndex,seaportLocalContext,seaportLocalAbi} from "./seaport-acquisition";
import {seaportAcquisitionProfile,validSeaportReview,type SeaportAcquisitionReview} from "../seaport-acquisition";
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const unavailable=()=>json({status:"unavailable",productionExecution:false,reason:"Exact local Seaport V2 evidence unavailable or conflicting"});
const same=(a:unknown,b:unknown)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
export function exactSeaportReviewTransaction(value:unknown,r:SeaportAcquisitionReview){
  if(!value||typeof value!=="object")return false;const t=value as Record<string,unknown>,q=r.request;
  return same(t.from,r.account)&&same(t.to,r.vault)&&same(t.input,q.data)&&t.chainId===31337&&t.type==="eip1559"&&typeof t.nonce==="number"&&Number.isSafeInteger(t.nonce)&&BigInt(t.nonce)===BigInt(q.nonce)&&t.value===0n&&t.gas===BigInt(q.gas)&&t.maxFeePerGas===BigInt(q.maxFeePerGas)&&t.maxPriorityFeePerGas===BigInt(q.maxPriorityFeePerGas)&&t.authorizationList==null&&(t.accessList==null||Array.isArray(t.accessList)&&t.accessList.length===0);
}
export function exactSeaportReviewCalldata(r:SeaportAcquisitionReview){try{
  const decoded=decodeFunctionData({abi:seaportLocalAbi,data:r.request.data}),args=decoded.args??[];
  if(!same(encodeFunctionData({abi:seaportLocalAbi,functionName:decoded.functionName,args}as never),r.request.data))return false;
  if(r.operation==="disable")return decoded.functionName==="disablePurchases"&&args.length===0&&r.listing===null&&Object.keys(r.fields).length===0;
  if(r.operation==="configure"){if(decoded.functionName!=="configurePolicy"||args.length!==2||r.listing!==null||Object.keys(r.fields).length!==6)return false;const[p,enabled]=args as unknown as[{currency:string;perNftCap:bigint;totalBudget:bigint;periodBudget:bigint;cooldownSeconds:number},boolean];return same(p.currency,r.fields.currency)&&String(p.perNftCap)===r.fields.perNftCap&&String(p.totalBudget)===r.fields.totalBudget&&String(p.periodBudget)===r.fields.periodBudget&&String(p.cooldownSeconds)===r.fields.cooldownSeconds&&enabled===r.fields.enabled;}
  if(r.operation!=="buy"||decoded.functionName!=="purchase"||args.length!==2||!r.listing)return false;
  const[a,q]=args as unknown as[{parameters:{zone:string;zoneHash:string;conduitKey:string;orderType:number;offer:Array<{token:string;identifierOrCriteria:bigint;startAmount:bigint;endAmount:bigint}>;consideration:Array<{token:string;recipient:string;startAmount:bigint;endAmount:bigint}>};numerator:bigint;denominator:bigint;extraData:string},{signedOrderHash:string;policyEpoch:bigint;controllerEpoch:bigint;deadline:number}];
  const p=a.parameters,n=p.offer[0],listing=r.listing,total=p.consideration.reduce((sum,c)=>sum+c.startAmount,0n);
  return a.numerator===1n&&a.denominator===1n&&a.extraData==="0x"&&p.orderType===0&&same(p.zone,zeroAddress)&&p.zoneHash===zeroHash&&p.conduitKey===zeroHash&&p.offer.length===1&&n.startAmount===n.endAmount&&p.consideration.length>0&&p.consideration.length<=8&&p.consideration.every(c=>c.startAmount===c.endAmount&&same(c.token,listing.currency))&&same(q.signedOrderHash,listing.orderHash)&&String(q.policyEpoch)===r.policyEpoch&&String(q.controllerEpoch)===r.controllerEpoch&&Number(q.deadline)===r.expiresAt&&same(n.token,listing.collection)&&String(n.identifierOrCriteria)===listing.tokenId&&String(n.startAmount)===listing.quantity&&same(listing.custody,r.vault)&&String(total)===listing.total&&listing.consideration.length===p.consideration.length&&p.consideration.every((c,i)=>same(c.recipient,listing.consideration[i].recipient)&&String(c.startAmount)===listing.consideration[i].amount);
}catch{return false;}}
export function exactSeaportSettlementListing(value:unknown,r:SeaportAcquisitionReview){
  if(!value||typeof value!=="object"||!r.listing)return false;const s=value as Record<string,unknown>,l=r.listing;
  return same(s.orderHash,l.orderHash)&&same(s.collection,l.collection)&&s.tokenId===l.tokenId&&s.quantity===l.quantity&&same(s.currency,l.currency)&&same(s.custody,r.vault)&&s.total===l.total&&Array.isArray(s.payments)&&s.payments.length===l.consideration.length&&s.payments.every((p:unknown,i:number)=>!!p&&typeof p==="object"&&same((p as Record<string,unknown>).recipient,l.consideration[i].recipient)&&(p as Record<string,unknown>).amount===l.consideration[i].amount);
}
/** Read only: locate this exact original nonce within the private candidate's
 * bounded lifetime. Unknown, replaced, reorged or unavailable evidence never
 * authorizes a new submission. Configuration and reverted calls need no NFT row. */
export async function findOriginalSeaportTransaction(rpc:PublicClient,birth:string,r:SeaportAcquisitionReview):Promise<Hash|undefined>{
  const deadline=Date.now()+8000;
  async function read<T>(action:()=>Promise<T>){const remaining=deadline-Date.now();if(remaining<=0)throw Error("Original transaction read budget exceeded");let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([action(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("Original transaction evidence unavailable")),remaining);})]);}finally{if(timer)clearTimeout(timer);}}
  const head=await read(()=>rpc.getBlock({blockTag:"latest"})),first=BigInt(birth);if(head.number===null||!head.hash||first<1n||head.number<first||head.number-first>=4096n)throw Error("Original transaction lifetime bound exceeded");
  if(BigInt(await read(()=>rpc.getTransactionCount({address:r.account,blockNumber:head.number!})))<=BigInt(r.request.nonce))return;
  for(let height=head.number;height>=first;height--){
    const block=await read(()=>rpc.getBlock({blockNumber:height,includeTransactions:true}));if(!block.hash||block.number!==height||block.transactions.length>32)throw Error("Original transaction block unavailable or exceeds bound");
    for(let index=0;index<block.transactions.length;index++){
      const tx=block.transactions[index];if(typeof tx!=="object"||tx===null)throw Error("Original transaction membership unavailable");
      if(!same(tx.from,r.account)||BigInt(tx.nonce)!==BigInt(r.request.nonce))continue;
      if(!exactSeaportReviewTransaction(tx,r))return;
      const receipt=await read(()=>rpc.getTransactionReceipt({hash:tx.hash})),canonical=await read(()=>rpc.getBlock({blockNumber:height})),tip=await read(()=>rpc.getBlock({blockNumber:head.number!}));
      if(!same(tx.blockHash,block.hash)||tx.blockNumber!==height||tx.transactionIndex!==index||!same(receipt.transactionHash,tx.hash)||!same(receipt.from,r.account)||!same(receipt.to,r.vault)||receipt.blockNumber!==height||receipt.transactionIndex!==index||!same(receipt.blockHash,block.hash)||!same(canonical.hash,block.hash)||!same(tip.hash,head.hash))throw Error("Original transaction canonical identity changed");
      return tx.hash;
    }
  }
}
export async function handleSeaportAcquisitionRead(request:Request){
  const c=configuredSeaportAcquisition(request.headers);if(!c)return json({status:"not-found"},404);
  try{const x=await seaportLocalContext(c),m=c.manifest;let history;try{history=await readSeaportIndex(c);}catch{history={status:"pending",settlements:[],checkpoint:null};}
    if(history.checkpoint){const block=await x.rpc.getBlock({blockNumber:BigInt(history.checkpoint.blockNumber)});if(block.hash?.toLowerCase()!==history.checkpoint.blockHash.toLowerCase())history={status:"pending",settlements:[],checkpoint:null};}
    const currency=x.policy[0],available=await x.read<bigint>("available",[currency]);
    return json({schemaVersion:1,profile:seaportAcquisitionProfile,chainId:31337,scope:"synthetic-local",productionExecution:false,status:"ready",vault:m.vault,projectToken:m.projectToken,controller:x.controller,controllerEpoch:String(x.controllerEpoch),policyEpoch:String(x.policyEpoch),policy:{currency,perNftCap:String(x.policy[1]),totalBudget:String(x.policy[2]),periodBudget:String(x.policy[3]),cooldownSeconds:String(x.policy[4])},states:{collectionVerified:true,currentOrderIndependentlyVerified:false,executionCompatible:true,vaultFunded:available>0n,purchases:x.enabled?"ON":"OFF",unavailable:true},availableReserveWei:String(available),collections:m.collections,history,notices:["Synthetic chain 31337 only. No current live listing has been verified.","The transaction caller pays network gas; only the separately funded vault reserve pays complete consideration.","A collection URL identifies a collection. It never authorizes an order or purchase.","Production purchasing remains NO-GO."]});
  }catch{return unavailable();}
}
export async function handleSeaportAcquisitionTest(request:Request){
  const c=configuredSeaportAcquisition(request.headers);if(!c)return json({status:"not-found"},404);
  if(request.headers.get("origin")!==c.site||!/^application\/json(?:;|$)/i.test(request.headers.get("content-type")??"")||Number(request.headers.get("content-length")??0)>65536)return json({status:"rejected"},400);
  try{const reader=request.body?.getReader();if(!reader)return json({status:"rejected"},400);let size=0;const chunks:Uint8Array[]=[];for(;;){const{value,done}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return json({status:"rejected"},413);}chunks.push(value);}const body=JSON.parse(Buffer.concat(chunks).toString("utf8"))as Record<string,unknown>;
    if(body.action==="prepare")return json(await prepareSeaportAcquisition(c,body));
    if(!validSeaportReview(body.review))return unavailable();const r=body.review;
    if(body.action==="revalidate"){const rebuilt=await prepareSeaportAcquisition(c,{account:r.account,operation:r.operation,fields:r.fields},r);if(rebuilt.reviewHash!==r.reviewHash)return unavailable();return json({status:"prepared",reviewHash:r.reviewHash,request:rebuilt.request});}
    if(body.action!=="verify")return json({status:"rejected"},400);
    if(!exactSeaportReviewCalldata(r))return unavailable();
    const x=await seaportLocalContext(c);if(x.m.vault.toLowerCase()!==r.vault.toLowerCase()||x.m.vaultRuntimeHash!==r.runtimeHash)return unavailable();
    const txHash=body.transactionHash;if(txHash!==undefined&&(typeof txHash!=="string"||!/^0x[0-9a-f]{64}$/i.test(txHash)))return unavailable();
    const original=txHash??await findOriginalSeaportTransaction(x.rpc,c.manifest.deployment.blockNumber,r);if(!original)return json({status:"pending",reviewHash:r.reviewHash,reason:"Original transaction not found within the bounded canonical candidate history"});
    const[tx,receipt]=await Promise.all([x.rpc.getTransaction({hash:original as `0x${string}`}),x.rpc.getTransactionReceipt({hash:original as `0x${string}`})]);const header=await x.rpc.getBlock({blockNumber:receipt.blockNumber});
    if(!same(header.hash,receipt.blockHash)||!same(tx.blockHash,receipt.blockHash))return json({status:"reorged",reviewHash:r.reviewHash});
    if(!exactSeaportReviewTransaction(tx,r)||!same(tx.hash,original)||!same(receipt.transactionHash,original)||!same(receipt.from,r.account)||!same(receipt.to,r.vault)||tx.blockNumber!==receipt.blockNumber||tx.transactionIndex!==receipt.transactionIndex||!same(header.transactions[receipt.transactionIndex],original))return unavailable();
    if(receipt.status==="reverted")return json({status:"reverted",reviewHash:r.reviewHash,transactionHash:original});
    if(receipt.status!=="success")return json({status:"pending",reviewHash:r.reviewHash,transactionHash:original});
    let rows:Array<{account:string;nonce:string;input:string;transactionHash:string;blockNumber:string;blockHash:string}>=[];if(r.operation==="buy"){let indexed;try{indexed=await readSeaportIndex(c,original as string);}catch{return json({status:"pending",reviewHash:r.reviewHash,transactionHash:original,reason:"Canonical durable trace evidence pending"});}rows=indexed.settlements.filter((row:{account:string;nonce:string;input:string;transactionHash:string})=>same(row.transactionHash,original)&&same(row.account,r.account)&&BigInt(row.nonce)===BigInt(r.request.nonce)&&same(row.input,r.request.data));}
    if(r.operation==="buy"&&(rows.length!==1||!exactSeaportSettlementListing(rows[0],r)))return json({status:"pending",reviewHash:r.reviewHash,reason:"Exact consideration and custody trace pending"});
    if(r.operation==="buy"&&(rows[0].blockNumber!==String(receipt.blockNumber)||!same(rows[0].blockHash,receipt.blockHash)))return unavailable();
    if(!same((await x.rpc.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash))return json({status:"reorged",reviewHash:r.reviewHash});
    return json({status:"confirmed",reviewHash:r.reviewHash,transactionHash:original,indexed:r.operation==="buy",settlement:r.operation==="buy"?rows[0]:null,canonical:{blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash},finality:"synthetic-local-not-production"});
  }catch{return json({status:"pending",reason:"Evidence or simulation unavailable; no submission attempted"});}
}
