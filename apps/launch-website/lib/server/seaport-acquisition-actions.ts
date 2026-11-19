import {NextResponse} from "next/server";
import {configuredSeaportAcquisition,prepareSeaportAcquisition,readSeaportIndex,seaportLocalContext} from "./seaport-acquisition";
import {seaportAcquisitionProfile,validSeaportReview} from "../seaport-acquisition";
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const unavailable=()=>json({status:"unavailable",productionExecution:false,reason:"Exact local Seaport V2 evidence unavailable or conflicting"});
export async function handleSeaportAcquisitionRead(request:Request){
  const c=configuredSeaportAcquisition(request.headers);if(!c)return json({status:"not-found"},404);
  try{const x=await seaportLocalContext(c),m=c.manifest;let history;try{history=await readSeaportIndex(c);}catch{history={status:"pending",settlements:[],checkpoint:null};}
    if(history.checkpoint){const block=await x.rpc.getBlock({blockNumber:BigInt(history.checkpoint.blockNumber)});if(block.hash?.toLowerCase()!==history.checkpoint.blockHash.toLowerCase())history={status:"pending",settlements:[],checkpoint:null};}
    const currency=x.policy[0],available=await x.read<bigint>("available",[currency]);
    return json({schemaVersion:1,profile:seaportAcquisitionProfile,chainId:31337,scope:"synthetic-local",productionExecution:false,status:"ready",vault:m.vault,projectToken:m.projectToken,controller:x.controller,controllerEpoch:String(x.controllerEpoch),policyEpoch:String(x.policyEpoch),policy:{currency,perNftCap:String(x.policy[1]),totalBudget:String(x.policy[2]),periodBudget:String(x.policy[3]),cooldownSeconds:String(x.policy[4])},states:{collectionVerified:true,currentOrderIndependentlyVerified:false,executionCompatible:true,vaultFunded:available>0n,purchases:x.enabled?"ON":"OFF",unavailable:false},availableReserveWei:String(available),collections:m.collections,history,notices:["Synthetic chain 31337 only. No current live listing has been verified.","The transaction caller pays network gas; only the separately funded vault reserve pays complete consideration.","A collection URL identifies a collection. It never authorizes an order or purchase.","Production purchasing remains NO-GO."]});
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
    const x=await seaportLocalContext(c);if(x.m.vault.toLowerCase()!==r.vault.toLowerCase()||x.m.vaultRuntimeHash!==r.runtimeHash)return unavailable();
    const txHash=body.transactionHash;if(txHash!==undefined&&(typeof txHash!=="string"||!/^0x[0-9a-f]{64}$/i.test(txHash)))return unavailable();
    let indexed;try{indexed=await readSeaportIndex(c,txHash as string|undefined);}catch{return json({status:"pending",reviewHash:r.reviewHash,reason:"Canonical durable trace evidence pending"});}
    const rows=indexed.settlements.filter((row:{account:string;nonce:string;input:string})=>row.account.toLowerCase()===r.account.toLowerCase()&&BigInt(row.nonce)===BigInt(r.request.nonce)&&row.input.toLowerCase()===r.request.data.toLowerCase());
    const original=txHash??(rows.length===1?rows[0].transactionHash:undefined);if(!original)return json({status:"pending",reviewHash:r.reviewHash});
    const[tx,receipt]=await Promise.all([x.rpc.getTransaction({hash:original as `0x${string}`}),x.rpc.getTransactionReceipt({hash:original as `0x${string}`})]);const header=await x.rpc.getBlock({blockNumber:receipt.blockNumber});
    if(header.hash!==receipt.blockHash||tx.blockHash!==receipt.blockHash)return json({status:"reorged",reviewHash:r.reviewHash});
    if(tx.from.toLowerCase()!==r.account.toLowerCase()||tx.to?.toLowerCase()!==r.vault.toLowerCase()||tx.input.toLowerCase()!==r.request.data.toLowerCase()||tx.chainId!==31337||tx.type!=="eip1559"||tx.nonce!==Number(BigInt(r.request.nonce))||tx.value!==0n||tx.gas!==BigInt(r.request.gas)||tx.maxFeePerGas!==BigInt(r.request.maxFeePerGas)||tx.maxPriorityFeePerGas!==BigInt(r.request.maxPriorityFeePerGas))return unavailable();
    if(receipt.status!=="success")return json({status:"reverted",reviewHash:r.reviewHash,transactionHash:original});
    if(r.operation==="buy"&&(rows.length!==1||!r.listing||rows[0].orderHash!==r.listing.orderHash||rows[0].custody.toLowerCase()!==r.vault.toLowerCase()||rows[0].total!==r.listing.total))return json({status:"pending",reviewHash:r.reviewHash,reason:"Exact consideration and custody trace pending"});
    return json({status:"confirmed",reviewHash:r.reviewHash,transactionHash:original,indexed:r.operation==="buy",settlement:r.operation==="buy"?rows[0]:null,canonical:{blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash},finality:"synthetic-local-not-production"});
  }catch{return json({status:"pending",reason:"Evidence or simulation unavailable; no submission attempted"});}
}
