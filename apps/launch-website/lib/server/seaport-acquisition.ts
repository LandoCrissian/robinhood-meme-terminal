import {readFileSync,statSync} from "node:fs";
import {isAbsolute} from "node:path";
import * as viem from "viem";
import {createSeaportVerifier} from "../../../../packages/launchpad-common/seaport-order-verifier.mjs";
import {seaportVaultFlag,seaportVaultSignatures,seaportVaultSeaportSignatures} from "../../../../packages/launchpad-common/seaport-vault-runtime.mjs";
import {seaportAcquisitionProfile,seaportAcquisitionReviewHash,validSeaportReview,type SeaportAcquisitionReview} from "../seaport-acquisition";
type Address=viem.Address;type Hex=viem.Hex;
export type SeaportLocalManifest={schemaVersion:1;profile:typeof seaportAcquisitionProfile;chainId:31337;vault:Address;vaultRuntimeHash:Hex;checks:Address;checksRuntimeHash:Hex;seaport:Address;seaportRuntimeHash:Hex;paymentToken:Address;paymentTokenRuntimeHash:Hex;projectToken:Address;creator:Address;coreFactory:Address;coreFactoryRuntimeHash:Hex;collections:Array<{address:Address;standard:721|1155;runtimeHash:Hex}>;deployment:{blockNumber:string;blockHash:Hex;transactionHash:Hex};compilerInputSha256:string;fee?:Address;safeSeller?:{address:Address}};
export type SeaportLocalConfig={site:string;rpc:string;indexer:string;readKey:string;manifest:SeaportLocalManifest};
const same=(a:unknown,b:unknown)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const need=(v:unknown)=>{if(!v)throw Error("Seaport V2 isolated evidence unavailable or conflicting");};
const address=(v:unknown):v is Address=>typeof v==="string"&&/^0x[0-9a-f]{40}$/i.test(v)&&BigInt(v)>0xffffn;
const hash=(v:unknown):v is Hex=>typeof v==="string"&&/^0x[0-9a-f]{64}$/i.test(v)&&BigInt(v)>0n;
const loopback=(v:string|undefined)=>{if(!v||!/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/.test(v))return null;const u=new URL(v);return Number(u.port)>=1024&&Number(u.port)<=65535?u.origin:null;};
export function configuredSeaportAcquisition(headers:Headers):SeaportLocalConfig|null{
  const e=process.env;if(e.RMT_SEAPORT_ACQUISITION_FIXTURE!==seaportVaultFlag||[e.NETLIFY,e.VERCEL,e.DEPLOY_ID,e.CONTEXT,e.RAILWAY_ENVIRONMENT_ID].some(Boolean)||headers.has("forwarded"))return null;
  const site=loopback(e.RMT_SEAPORT_ACQUISITION_SITE),rpc=loopback(e.RMT_SEAPORT_ACQUISITION_RPC),indexer=loopback(e.RMT_SEAPORT_ACQUISITION_INDEXER),readKey=e.RMT_SEAPORT_ACQUISITION_READ_KEY,path=e.RMT_SEAPORT_ACQUISITION_MANIFEST;
  if(!site||!rpc||!indexer||new Set([site,rpc,indexer]).size!==3||headers.get("host")!==new URL(site).host||headers.get("x-forwarded-host")&&headers.get("x-forwarded-host")!==new URL(site).host||headers.get("x-forwarded-proto")&&headers.get("x-forwarded-proto")!=="http"||!readKey||!/^[a-f0-9]{64}$/.test(readKey)||/^0+$/.test(readKey)||!path||!isAbsolute(path))return null;
  try{if(statSync(path).size>32768)return null;const m=JSON.parse(readFileSync(path,"utf8"))as SeaportLocalManifest;
    if(m.schemaVersion!==1||m.profile!==seaportAcquisitionProfile||m.chainId!==31337||![m.vault,m.checks,m.seaport,m.paymentToken,m.projectToken,m.creator,m.coreFactory].every(address)||![m.vaultRuntimeHash,m.checksRuntimeHash,m.seaportRuntimeHash,m.paymentTokenRuntimeHash,m.coreFactoryRuntimeHash,m.deployment.blockHash,m.deployment.transactionHash].every(hash)||!/^[1-9][0-9]{0,15}$/.test(m.deployment.blockNumber)||!/^[a-f0-9]{64}$/i.test(m.compilerInputSha256)||!Array.isArray(m.collections)||m.collections.length<1||m.collections.length>8||!m.collections.every(c=>address(c.address)&&hash(c.runtimeHash)&&[721,1155].includes(c.standard))||new Set(m.collections.map(c=>c.address.toLowerCase())).size!==m.collections.length)return null;
    return{site,rpc,indexer,readKey,manifest:m};
  }catch{return null;}
}
export const seaportLocalAbi=viem.parseAbi(seaportVaultSignatures);
export const seaportLocalRpc=(c:SeaportLocalConfig)=>viem.createPublicClient({transport:viem.http(c.rpc,{retryCount:0,timeout:8000,fetchOptions:{redirect:"error",cache:"no-store"}}),cacheTime:0});
export async function seaportLocalContext(c:SeaportLocalConfig){
  const rpc=seaportLocalRpc(c),m=c.manifest;need(await rpc.getChainId()===31337);const head=await rpc.getBlock();need(head.number!==null&&head.hash);
  for(const[a,h]of[[m.vault,m.vaultRuntimeHash],[m.checks,m.checksRuntimeHash],[m.seaport,m.seaportRuntimeHash],[m.paymentToken,m.paymentTokenRuntimeHash],[m.coreFactory,m.coreFactoryRuntimeHash],...m.collections.map(x=>[x.address,x.runtimeHash])]as[Address,Hex][]){const code=await rpc.getCode({address:a,blockNumber:head.number});need(code&&same(viem.keccak256(code),h));}
  const read=async<T>(functionName:string,args:readonly unknown[]=[])=>rpc.readContract({address:m.vault,abi:seaportLocalAbi,functionName,args,blockNumber:head.number}as never)as Promise<T>;
  for(const[k,v]of Object.entries({creator:m.creator,projectToken:m.projectToken,checks:m.checks,checksHash:m.checksRuntimeHash,coreFactory:m.coreFactory,coreFactoryHash:m.coreFactoryRuntimeHash,seaport:m.seaport,seaportHash:m.seaportRuntimeHash,paymentToken:m.paymentToken,paymentTokenHash:m.paymentTokenRuntimeHash})){need(same(await read(k),v));}
  const cc=await read<Address>("conduitController"),ccHash=await read<Hex>("conduitControllerHash"),tokenHash=await read<Hex>("tokenRuntimeHash");
  for(const[a,h]of[[cc,ccHash],[m.projectToken,tokenHash]]as[Address,Hex][]){const code=await rpc.getCode({address:a,blockNumber:head.number});need(code&&same(viem.keccak256(code),h));}
  const receipt=await rpc.getTransactionReceipt({hash:m.deployment.transactionHash}),birth=await rpc.getBlock({blockNumber:BigInt(m.deployment.blockNumber)});need(receipt.status==="success"&&same(receipt.contractAddress,m.vault)&&receipt.blockNumber===BigInt(m.deployment.blockNumber)&&same(receipt.blockHash,m.deployment.blockHash)&&same(birth.hash,m.deployment.blockHash));
  const origin=await read<Address>("originCurve"),bindingAbi=viem.parseAbi(["function originCurveForToken(address) view returns(address)","function creator() view returns(address)","function token() view returns(address)","function factory() view returns(address)"]);
  need(same(await rpc.readContract({address:m.coreFactory,abi:bindingAbi,functionName:"originCurveForToken",args:[m.projectToken],blockNumber:head.number}),origin));
  for(const[name,wanted]of Object.entries({creator:m.creator,token:m.projectToken,factory:m.coreFactory}))need(same(await rpc.readContract({address:origin,abi:bindingAbi,functionName:name,blockNumber:head.number}as never),wanted));
  need(await read("productionExecutionAvailable")===false&&await read("deploymentChainId")===31337n);
  const[controller,controllerEpoch,policyEpoch,enabled,policy]=await Promise.all([read<Address>("controller"),read<bigint>("controllerEpoch"),read<bigint>("policyEpoch"),read<boolean>("purchasesEnabled"),read<readonly[Address,bigint,bigint,bigint,number]>("policy")]);
  for(const collection of m.collections){const admitted=await read<readonly[Hex,number,boolean,boolean]>("collections",[collection.address]);need(same(admitted[0],collection.runtimeHash)&&admitted[1]===(collection.standard===721?1:2));}
  return{rpc,m,head,read,controller,controllerEpoch,policyEpoch,enabled,policy};
}
export async function readSeaportIndex(c:SeaportLocalConfig,transaction?:string){
  const response=await fetch(c.indexer+"/seaport-acquisition"+(transaction?"?transaction="+transaction:""),{headers:{Authorization:"Bearer "+c.readKey},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(8000)});need(response.ok&&Number(response.headers.get("content-length")??0)<=131072);const text=await response.text();need(text.length<=131072);const value=JSON.parse(text);need(value.profile===seaportAcquisitionProfile&&value.chainId===31337&&value.productionExecution===false&&Array.isArray(value.settlements)&&value.settlements.length<=64);return value;
}
export async function prepareSeaportAcquisition(c:SeaportLocalConfig,body:Record<string,unknown>,prior?:SeaportAcquisitionReview,observe?:(stage:string)=>void):Promise<SeaportAcquisitionReview>{
  const mark=(stage:string)=>observe?.(stage);mark("VALIDATE_PREPARE");
  need(address(body.account)&&["buy","configure","disable"].includes(String(body.operation))&&body.fields&&typeof body.fields==="object"&&!Array.isArray(body.fields));
  const fields=body.fields as Record<string,unknown>;mark("LOCAL_CONTEXT");const x=await seaportLocalContext(c),{rpc,m,head}=x,account=viem.getAddress(body.account as Address),operation=body.operation as SeaportAcquisitionReview["operation"];
  mark("CALLER_CODE");need((await rpc.getCode({address:account,blockTag:"pending"})??"0x")==="0x");
  mark("FRESHNESS");const expiresAt=prior?.expiresAt??Number(head.timestamp)+180;need(expiresAt>Number(head.timestamp)&&expiresAt<=Number(head.timestamp)+300);
  let data:Hex,listing:SeaportAcquisitionReview["listing"]=null;
  mark(operation==="buy"?"BUILD_BUY":operation==="configure"?"BUILD_CONFIGURE":"BUILD_DISABLE");
  if(operation==="buy"){
    need(Object.keys(fields).length===2&&fields.identityConfirmed===true&&fields.order&&JSON.stringify(fields.order).length<=32768);
    const verifier=createSeaportVerifier(viem),o=verifier.normalizeSeaportOrder(fields.order),d=verifier.seaportOrderDigest(fields.order),p=o.parameters,n=p.offer[0];
    need(o.chainId===31337&&same(o.seaport,m.seaport)&&p.conduitKey===viem.zeroHash&&m.collections.some(c=>same(c.address,n.token)&&c.standard===(n.itemType===2?721:1155))&&p.startTime<=head.timestamp&&p.endTime>BigInt(expiresAt));
    const currency=p.consideration[0].token,total=p.consideration.reduce((s:bigint,c:{startAmount:bigint})=>s+c.startAmount,0n)as bigint;
    need(same(currency,viem.zeroAddress)||same(currency,m.paymentToken));
    const a={parameters:p,numerator:1n,denominator:1n,signature:o.signature,extraData:"0x"},r={signedOrderHash:d.orderHash,counter:o.components.counter,policyEpoch:x.policyEpoch,controllerEpoch:x.controllerEpoch,deadline:expiresAt};
    mark("ORDER_HASH");need(same(await rpc.readContract({address:m.seaport,abi:viem.parseAbi(seaportVaultSeaportSignatures),functionName:"getOrderHash",args:[o.components],blockNumber:head.number}as never),d.orderHash));
    data=viem.encodeFunctionData({abi:seaportLocalAbi,functionName:"purchase",args:[a,r]});
    listing={orderHash:d.orderHash,collection:n.token,tokenId:String(n.identifierOrCriteria),quantity:String(n.startAmount),currency,total:String(total),custody:m.vault,consideration:p.consideration.map((c:{recipient:Address;startAmount:bigint})=>({recipient:c.recipient,amount:String(c.startAmount)}))};
  }else if(operation==="disable"){need(Object.keys(fields).length===0&&same(account,x.controller));data=viem.encodeFunctionData({abi:seaportLocalAbi,functionName:"disablePurchases"});}
  else{need(same(account,x.controller)&&Object.keys(fields).length===6&&typeof fields.enabled==="boolean");const currency=fields.currency;need(currency===viem.zeroAddress||same(currency,m.paymentToken));const values=["perNftCap","totalBudget","periodBudget","cooldownSeconds"].map(k=>{need(typeof fields[k]==="string"&&/^[1-9][0-9]{0,38}$/.test(fields[k]as string));return BigInt(fields[k]as string);});need(values.slice(0,3).every(n=>n<2n**128n)&&values[3]<2n**32n);data=viem.encodeFunctionData({abi:seaportLocalAbi,functionName:"configurePolicy",args:[{currency,perNftCap:values[0],totalBudget:values[1],periodBudget:values[2],cooldownSeconds:Number(values[3])},fields.enabled]});}
  mark("SIMULATE_PENDING");await rpc.call({account,to:m.vault,data,value:0n,blockTag:"pending"});
  mark("ESTIMATE_GAS_NONCE_FEES");const[estimated,nonce,priority]=await Promise.all([rpc.estimateGas({account,to:m.vault,data,value:0n}),rpc.getTransactionCount({address:account,blockTag:"pending"}),rpc.estimateMaxPriorityFeePerGas()]);
  mark("FEE_BOUNDS");const gas=estimated*125n/100n,fee=(head.baseFeePerGas??0n)*2n+priority;need(gas>0n&&gas<=20_000_000n&&fee>0n);
  let request:SeaportAcquisitionReview["request"]={type:"0x2",chainId:"0x7a69",from:account,to:m.vault,data,value:"0x0",nonce:viem.toHex(nonce),gas:viem.toHex(gas),maxFeePerGas:viem.toHex(fee),maxPriorityFeePerGas:viem.toHex(priority)};
  mark("PRIOR_REVIEW");if(prior){need(validSeaportReview(prior)&&same(prior.vault,m.vault)&&same(prior.runtimeHash,m.vaultRuntimeHash)&&same(prior.request.data,data)&&BigInt(prior.request.nonce)===BigInt(nonce)&&estimated<=BigInt(prior.request.gas)&&(head.baseFeePerGas??0n)+priority<=BigInt(prior.request.maxFeePerGas));request=prior.request;}
  const maximumNetworkFeeWei=String(BigInt(request.gas)*BigInt(request.maxFeePerGas));mark("PAYER_BALANCE");need(await rpc.getBalance({address:account,blockTag:"pending"})>=BigInt(maximumNetworkFeeWei));
  const review={schemaVersion:1 as const,profile:seaportAcquisitionProfile,chainId:31337 as const,scope:"synthetic-local" as const,productionExecution:false as const,operation,account,vault:m.vault,runtimeHash:m.vaultRuntimeHash,controllerEpoch:String(x.controllerEpoch),policyEpoch:String(x.policyEpoch),expiresAt,fields,request,maximumNetworkFeeWei,listing};return{...review,reviewHash:seaportAcquisitionReviewHash(review)};
}
