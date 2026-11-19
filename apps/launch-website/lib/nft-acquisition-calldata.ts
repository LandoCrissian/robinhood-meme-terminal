import {decodeFunctionData,encodeFunctionData,erc20Abi,parseAbi,zeroAddress,type Address,type Hex} from "viem";
import {nftAcquisitionVaultSignatures} from "../../../packages/launchpad-common/nft-acquisition-runtime.mjs";
import type {NftAcquisitionReview} from "./nft-acquisition";
const abi=parseAbi(nftAcquisitionVaultSignatures);
export const nftAcquisitionOperationFields={"fund-native":["amountWei","source"],"approve-funding":["amountWei"],"fund-token":["amountWei","source"],configure:["currency","perNftCap","totalBudget","periodBudget","cooldownSeconds","enabled"],"configure-collection":["collection","enabled","anyTokenId","ids","identityConfirmed"],disable:[],buy:["order","signature","identityConfirmed"],"schedule-controller":["incoming","expiresAt"],"cancel-controller":[],"accept-controller":[],"schedule-nft-withdrawal":["collection","tokenId","quantity","recipient","expiresAt"],"schedule-asset-withdrawal":["currency","amountWei","recipient","expiresAt"],"execute-withdrawal":["id"],"cancel-withdrawal":["id"]}as const;
const same=(a:unknown,b:unknown)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const uint=(v:unknown)=>{if(typeof v!=="string"||!/^(0|[1-9][0-9]{0,77})$/.test(v)||BigInt(v)>=2n**256n)throw Error("Invalid integer");return BigInt(v);};
const addr=(v:unknown):Address=>{if(typeof v!=="string"||!/^0x[0-9a-f]{40}$/i.test(v))throw Error("Invalid address");return v as Address;};
const hash=(v:unknown)=>typeof v==="string"&&/^0x[0-9a-f]{64}$/i.test(v)&&BigInt(v)>0n;
/** Independent browser binding between displayed fields and ABI calldata.
 * Runtime/source admission remains the server's pinned-manifest check. */
export function nftAcquisitionCalldataMatchesReview(r:NftAcquisitionReview):boolean{try{
  const f=r.fields,keys:readonly string[]=nftAcquisitionOperationFields[r.operation],approve=r.operation==="approve-funding",decoded=decodeFunctionData({abi:approve?erc20Abi:abi,data:r.innerCall.data});let name:string,args:readonly unknown[],value:Hex="0x0";
  if(!keys||keys.length!==Object.keys(f).length||!keys.every(k=>Object.hasOwn(f,k)))return false;
  if(!approve&&!same(r.innerCall.to,r.vault))return false;
  switch(r.operation){
    case"fund-native":name="fundNative";args=[f.source];value=("0x"+uint(f.amountWei).toString(16))as Hex;if(!hash(f.source))return false;break;
    case"approve-funding":name="approve";args=[r.vault,uint(f.amountWei)];if(same(r.innerCall.to,r.vault))return false;break;
    case"fund-token":name="fundToken";args=[uint(f.amountWei),f.source];if(!hash(f.source))return false;break;
    case"configure":name="configurePolicy";args=[{currency:addr(f.currency),perNftCap:uint(f.perNftCap),totalBudget:uint(f.totalBudget),periodBudget:uint(f.periodBudget),cooldownSeconds:Number(uint(f.cooldownSeconds))},f.enabled];if(typeof f.enabled!=="boolean")return false;break;
    case"configure-collection":{name="configureCollection";const actual=decoded.args as readonly unknown[];if(f.identityConfirmed!==true||![1,2].includes(actual[1]as number)||!hash(actual[2])||typeof f.ids!=="string"||typeof f.enabled!=="boolean"||typeof f.anyTokenId!=="boolean")return false;
      const ids=f.ids===""?[]:f.ids.split(",").map(uint);if(ids.length>32||ids.some((id,i)=>i>0&&id<=ids[i-1]))return false;args=[addr(f.collection),actual[1],actual[2],f.enabled,f.anyTokenId,ids];break;}
    case"disable":name="disablePurchases";args=[];break;
    case"buy":{name="purchase";if(f.identityConfirmed!==true||typeof f.order!=="string"||f.order.length>8192||!r.listing)return false;const raw=JSON.parse(f.order),o={...raw};
      for(const k of["tokenId","quantity","sellerAmount","feeAmount","royaltyAmount","sellerNonce"])o[k]=uint(raw[k]);
      const l=r.listing;if(!same(o.vault,r.vault)||!same(o.collection,l.collection)||!same(o.seller,l.seller)||!same(o.currency,l.paymentAsset)||String(o.tokenId)!==l.tokenId||String(o.quantity)!==l.quantity||o.standard!==(l.standard===721?1:2)||String(o.sellerAmount+o.feeAmount+o.royaltyAmount)!==l.allInWei||String(o.endTime)!==l.expiry||!same(l.custody,r.vault))return false;
      args=[o,f.signature,uint(r.policyEpoch),uint(r.controllerEpoch),r.expiresAt];break;}
    case"schedule-controller":name="proposeController";args=[addr(f.incoming),uint(f.expiresAt)];break;
    case"cancel-controller":name="cancelController";args=[];break;
    case"accept-controller":name="acceptController";args=[];break;
    case"schedule-nft-withdrawal":name="scheduleNftWithdrawal";args=[addr(f.collection),uint(f.tokenId),uint(f.quantity),addr(f.recipient),uint(f.expiresAt)];break;
    case"schedule-asset-withdrawal":name="scheduleAssetWithdrawal";args=[addr(f.currency),uint(f.amountWei),addr(f.recipient),uint(f.expiresAt)];break;
    case"execute-withdrawal":name="executeWithdrawal";args=[uint(f.id)];break;
    case"cancel-withdrawal":name="cancelWithdrawal";args=[uint(f.id)];break;
    default:return false;
  }
  return decoded.functionName===name&&same(encodeFunctionData({abi:approve?erc20Abi:abi,functionName:name,args}as never),r.innerCall.data)&&r.innerCall.value===value
    &&(r.listing===null||r.listing.paymentAsset===zeroAddress||/^0x[0-9a-f]{40}$/i.test(r.listing.paymentAsset));
}catch{return false;}}
