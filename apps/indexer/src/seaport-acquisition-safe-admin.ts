import * as viem from "viem";
import {readSeaportSafeState,safeAuthorityIdentity,seaportSafeTypedData,seaportSafePins,seaportSafeSignatures,seaportSafeVaultSignatures,decodeSeaportSafeCall,verifySeaportSafeApprovals,assertSeaportSafeAdminTrace,assertSeaportSafeAdminRevertTrace,type SeaportSafeTx} from "../../../packages/launchpad-common/seaport-vault-safe.mjs";
import {reclaimCallerPins} from "./reclaim-fixture-origin.js";
import {verifySeaportVaultRuntime} from "./seaport-acquisition-evidence.js";
import type {SeaportVaultManifest,SeaportVaultPoint} from "./seaport-acquisition-types.js";
type Address=viem.Address;type Hash=viem.Hash;type Hex=viem.Hex;type Rpc=viem.PublicClient;
export type SeaportSafeAdminReceipt=SeaportVaultPoint&{transactionHash:Hash;transactionIndex:number;status:"success"|"reverted";vault:Address;projectToken:Address;safe:Address;safeNonce:string;safeNonceAfter:string;gasPayer:Address;gasPayerNonce:string;gasCostWei:string;digest:Hash;owners:Address[];signers:Address[];operation:string;fields:Record<string,string|boolean>;target:Address;input:Hex;value:string;outerInput:Hex;proof:{evidence:string;frames:number;nativeTransfers:number}};
const safeAbi=viem.parseAbi(seaportSafeSignatures),vaultAbi=viem.parseAbi(seaportSafeVaultSignatures);
const selector=viem.toFunctionSelector("execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)");
const same=(a:unknown,b:unknown)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const need=(v:unknown)=>{if(!v)throw Error("Exact Seaport Safe admin receipt unavailable or conflicting");};
class UnsupportedSafeAdmin extends Error{}
const hashArgs=(s:SeaportSafeTx)=>[s.to,BigInt(s.value),s.data,0,0n,0n,0n,viem.zeroAddress,viem.zeroAddress,BigInt(s.nonce)]as const;
async function boundPayer(rpc:Rpc,payer:Address,before:bigint,after:bigint){
 const a=await rpc.getCode({address:payer,blockNumber:before}),b=await rpc.getCode({address:payer,blockNumber:after});need(same(a??"0x",b??"0x"));
 if(a&&a!=="0x"){need(same(a,reclaimCallerPins.designator));for(const blockNumber of[before,after]){const code=await rpc.getCode({address:reclaimCallerPins.delegate,blockNumber});need(code&&same(viem.keccak256(code),reclaimCallerPins.delegateHash));}}
}
export async function seaportSafeAdminCandidates(rpc:Rpc,m:SeaportVaultManifest,height:bigint){
 if(height<=BigInt(m.deployment.blockNumber))return[];const values=new Set<Address>();
 for(const blockNumber of[height-1n,height]){
  const controller=await rpc.readContract({address:m.vault,abi:vaultAbi,functionName:"controller",blockNumber})as Address;
  const pending=await rpc.readContract({address:m.vault,abi:vaultAbi,functionName:"pendingController",blockNumber})as readonly[Address,number,number,bigint];
  for(const address of[controller,pending[0]]){if(same(address,viem.zeroAddress))continue;const code=await rpc.getCode({address,blockNumber});if(code&&same(viem.keccak256(code),seaportSafePins.proxyHash))values.add(address);}
 }
 return [...values];
}
async function verifyReceipt(rpc:Rpc,m:SeaportVaultManifest,hash:Hash):Promise<SeaportSafeAdminReceipt>{
 need(await rpc.getChainId()===31337);const receipt=await rpc.getTransactionReceipt({hash}),tx=await rpc.getTransaction({hash}),h=await rpc.getBlock({blockNumber:receipt.blockNumber}),before=receipt.blockNumber-1n;
 need(before>=0n&&h.hash&&same(h.hash,receipt.blockHash)&&same(tx.blockHash,receipt.blockHash)&&tx.blockNumber===receipt.blockNumber&&tx.transactionIndex===receipt.transactionIndex
  &&h.transactions.length===1&&receipt.transactionIndex===0&&same(h.transactions[0],hash)&&same(tx.hash,hash)&&same(receipt.transactionHash,hash)&&same(tx.from,receipt.from)&&tx.to&&same(tx.to,receipt.to)
  &&tx.chainId===31337&&tx.type==="eip1559"&&tx.value===0n&&tx.authorizationList==null&&(tx.accessList==null||tx.accessList.length===0)&&receipt.logs.length<=128);
 await verifySeaportVaultRuntime(rpc,m,receipt.blockNumber);await boundPayer(rpc,tx.from,before,receipt.blockNumber);
 need(tx.nonce===await rpc.getTransactionCount({address:tx.from,blockNumber:before})&&!same(tx.from,tx.to));
 const logIds=new Set<number>();for(const log of receipt.logs){need(!log.removed&&same(log.blockHash,receipt.blockHash)&&log.blockNumber===receipt.blockNumber&&same(log.transactionHash,hash)&&log.transactionIndex===receipt.transactionIndex&&Number.isSafeInteger(log.logIndex)&&!logIds.has(log.logIndex));logIds.add(log.logIndex);}
 const decoded=viem.decodeFunctionData({abi:safeAbi,data:tx.input});need(decoded.functionName==="execTransaction"&&decoded.args&&same(viem.encodeFunctionData({abi:safeAbi,functionName:"execTransaction",args:decoded.args}as never),tx.input));
 const a=decoded.args as unknown as readonly[Address,bigint,Hex,number,bigint,bigint,bigint,Address,Address,Hex];
 need(a[3]===0&&a[4]===0n&&a[5]===0n&&a[6]===0n&&same(a[7],viem.zeroAddress)&&same(a[8],viem.zeroAddress)&&/^0x[0-9a-f]{260}$/i.test(a[9]));
 const safe=tx.to!,pre=await readSeaportSafeState(rpc,safe,before,viem),post=await readSeaportSafeState(rpc,safe,receipt.blockNumber,viem);
 const safeTx:SeaportSafeTx={to:a[0],value:String(a[1]),data:a[2],operation:0,safeTxGas:"0",baseGas:"0",gasPrice:"0",gasToken:viem.zeroAddress,refundReceiver:viem.zeroAddress,nonce:pre.nonce};
 const typed=seaportSafeTypedData(safe,safeTx),digest=viem.hashTypedData(typed),approvals=[];
 for(let i=0;i<2;i++){const signature=("0x"+a[9].slice(2+i*130,2+(i+1)*130))as Hex;approvals.push({signer:await viem.recoverTypedDataAddress({...typed,signature}),signature});}
 if(!await verifySeaportSafeApprovals(safe,safeTx,pre.owners,approvals,viem))throw new UnsupportedSafeAdmin("Unadmitted Safe authorization");
 need(safeAuthorityIdentity(pre)===safeAuthorityIdentity(post)&&same(await rpc.readContract({address:safe,abi:safeAbi,functionName:"getTransactionHash",args:hashArgs(safeTx),blockNumber:before}as never),digest));
 const inner=decodeSeaportSafeCall(m,a[0],a[2],a[1],viem),get=async<T>(name:string,height:bigint,args:readonly unknown[]=[])=>rpc.readContract({address:m.vault,abi:vaultAbi,functionName:name,args,blockNumber:height}as never)as Promise<T>;
 const [controller,ce,pe,controllerAfter,ceAfter,peAfter,pending,pendingAfter]=await Promise.all([get<Address>("controller",before),get<bigint>("controllerEpoch",before),get<bigint>("policyEpoch",before),get<Address>("controller",receipt.blockNumber),get<bigint>("controllerEpoch",receipt.blockNumber),get<bigint>("policyEpoch",receipt.blockNumber),get<readonly[Address,number,number,bigint]>("pendingController",before),get<readonly[Address,number,number,bigint]>("pendingController",receipt.blockNumber)]);
 const events=viem.parseEventLogs({abi:vaultAbi,strict:true,logs:receipt.logs.filter(l=>same(l.address,m.vault))})as unknown as {eventName:string;args:any}[];
 const outcomes=viem.parseEventLogs({abi:safeAbi,strict:true,logs:receipt.logs.filter(l=>same(l.address,safe))}).filter(e=>e.eventName==="ExecutionSuccess"||e.eventName==="ExecutionFailure");
 const admittedSafes:Address[]=[];if(inner.operation==="propose-controller"){const incoming=inner.fields.incoming as Address,code=await rpc.getCode({address:incoming,blockNumber:before});if(code&&code!=="0x"){const incomingPre=await readSeaportSafeState(rpc,incoming,before,viem),incomingPost=await readSeaportSafeState(rpc,incoming,receipt.blockNumber,viem);need(safeAuthorityIdentity(incomingPre)===safeAuthorityIdentity(incomingPost)&&incomingPre.nonce===incomingPost.nonce);admittedSafes.push(incoming);}}
 const trace=await rpc.request({method:"debug_traceTransaction",params:[hash,{tracer:"callTracer"}]}as never),origin={from:tx.from,to:safe,input:tx.input,value:0n},expected={safe,target:a[0],data:a[2],value:a[1],admittedSafes};
 let proof;
 if(receipt.status==="reverted"){
  need(post.nonce===pre.nonce&&outcomes.length===0&&events.length===0&&same(controller,controllerAfter)&&ceAfter===ce&&peAfter===pe);
  const raw=trace as {output?:Hex};need(raw.output);const error=viem.decodeErrorResult({abi:viem.parseAbi(["error Error(string)"]),data:raw.output!});need(error.errorName==="Error"&&error.args?.[0]==="GS013");
  proof=assertSeaportSafeAdminRevertTrace(trace,origin,expected);
  need(await rpc.getBalance({address:safe,blockNumber:before})===await rpc.getBalance({address:safe,blockNumber:receipt.blockNumber}));
 }else{
  need(receipt.status==="success"&&BigInt(post.nonce)===BigInt(pre.nonce)+1n&&outcomes.length===1&&outcomes[0]!.eventName==="ExecutionSuccess"&&same((outcomes[0]!.args as {txHash:Hash}).txHash,digest)&&(outcomes[0]!.args as {payment:bigint}).payment===0n);
  proof=assertSeaportSafeAdminTrace(trace,origin,expected);
  if(inner.operation==="accept-controller"){need(same(pending[0],safe)&&pending[3]===ce&&BigInt(pending[1])<=h.timestamp&&BigInt(pending[2])>=h.timestamp&&pending[1]>0&&same(controllerAfter,safe)&&ceAfter===ce+1n&&peAfter===pe+1n&&same(pendingAfter[0],viem.zeroAddress)&&await get("purchasesEnabled",receipt.blockNumber)===false);}
  else need(same(controller,safe)&&same(controllerAfter,controller)&&ceAfter===ce);
  const event=(name:string)=>{need(events.length===1&&events[0]!.eventName===name);return events[0]!.args;};
  if(inner.operation==="configure"||inner.operation==="disable"){
   const e=event("PurchasePolicyChanged");need(peAfter===pe+1n&&e.policyEpoch===peAfter&&e.controllerEpoch===ceAfter);
   if(inner.operation==="disable")need(e.enabled===false&&await get("purchasesEnabled",receipt.blockNumber)===false);
   else{const f=inner.fields,p=await get<readonly[Address,bigint,bigint,bigint,number]>("policy",receipt.blockNumber);need(e.enabled===f.enabled&&same(e.currency,f.currency)&&String(e.perNftCap)===f.perNftCap&&String(e.totalBudget)===f.totalBudget&&String(e.periodBudget)===f.periodBudget&&String(e.cooldownSeconds)===f.cooldownSeconds&&same(p[0],f.currency)&&String(p[1])===f.perNftCap&&String(p[2])===f.totalBudget&&String(p[3])===f.periodBudget&&String(p[4])===f.cooldownSeconds);}
  }else if(inner.operation==="fund-native"||inner.operation==="fund-token"){
   const native=inner.operation==="fund-native",currency=native?viem.zeroAddress:m.paymentToken,amount=BigInt(String(inner.fields.amountWei)),e=event("FundingReceived");
   need(same(e.currency,currency)&&same(e.sender,safe)&&e.amount===amount&&same(e.source,inner.fields.source)&&peAfter===pe);
   for(const name of["accountedHeld","funded"]){need(await get<bigint>(name,receipt.blockNumber,[currency])===await get<bigint>(name,before,[currency])+amount);}
   if(native){need(a[1]===amount&&await rpc.getBalance({address:safe,blockNumber:receipt.blockNumber})+amount===await rpc.getBalance({address:safe,blockNumber:before})&&await rpc.getBalance({address:m.vault,blockNumber:receipt.blockNumber})===await rpc.getBalance({address:m.vault,blockNumber:before})+amount);}
   else{
    const balance=(who:Address,blockNumber:bigint)=>rpc.readContract({address:currency,abi:viem.erc20Abi,functionName:"balanceOf",args:[who],blockNumber});
    need(await balance(safe,receipt.blockNumber)+amount===await balance(safe,before)&&await balance(m.vault,receipt.blockNumber)===await balance(m.vault,before)+amount);
    need(await rpc.readContract({address:currency,abi:viem.erc20Abi,functionName:"allowance",args:[safe,m.vault],blockNumber:before})===amount&&await rpc.readContract({address:currency,abi:viem.erc20Abi,functionName:"allowance",args:[safe,m.vault],blockNumber:receipt.blockNumber})===0n);
    const transfers=viem.parseEventLogs({abi:viem.erc20Abi,eventName:"Transfer",strict:true,logs:receipt.logs.filter(l=>same(l.address,currency))});need(transfers.length===1&&same(transfers[0]!.args.from,safe)&&same(transfers[0]!.args.to,m.vault)&&transfers[0]!.args.value===amount);
   }
  }else if(inner.operation==="approve-funding"){
   need(events.length===0&&peAfter===pe);const amount=BigInt(String(inner.fields.amountWei)),approvals=viem.parseEventLogs({abi:viem.erc20Abi,eventName:"Approval",strict:true,logs:receipt.logs.filter(l=>same(l.address,m.paymentToken))});
   need(approvals.length===1&&same(approvals[0]!.args.owner,safe)&&same(approvals[0]!.args.spender,m.vault)&&approvals[0]!.args.value===amount&&await rpc.readContract({address:m.paymentToken,abi:viem.erc20Abi,functionName:"allowance",args:[safe,m.vault],blockNumber:before})===0n&&await rpc.readContract({address:m.paymentToken,abi:viem.erc20Abi,functionName:"allowance",args:[safe,m.vault],blockNumber:receipt.blockNumber})===amount);
  }else if(inner.operation==="configure-collection"){
   const e=event("CollectionConfigured"),f=inner.fields,c=m.collections.find(c=>same(c.address,f.collection))!;const selected=String(f.ids)===""?[]:String(f.ids).split(",");
   const postCollection=await get<readonly[Hash,number,boolean,boolean]>("collections",receipt.blockNumber,[c.address]),ids=await get<bigint[]>("collectionIds",receipt.blockNumber,[c.address]);
   need(peAfter===pe+1n&&e.policyEpoch===peAfter&&same(e.collection,c.address)&&same(e.runtimeHash,c.runtimeHash)&&e.standard===(c.standard===721?1:2)&&e.enabled===f.enabled&&e.anyTokenId===f.anyTokenId&&JSON.stringify(e.ids.map(String))===JSON.stringify(selected)&&same(postCollection[0],c.runtimeHash)&&postCollection[1]===(c.standard===721?1:2)&&postCollection[2]===f.enabled&&postCollection[3]===f.anyTokenId&&JSON.stringify(ids.map(String))===JSON.stringify(selected));
  }else if(inner.operation==="configure-fee-recipient"){
   const e=event("FeeRecipientConfigured");need(peAfter===pe+1n&&e.policyEpoch===peAfter&&same(e.recipient,inner.fields.recipient)&&String(e.maxBps)===inner.fields.maxBps&&String(await get("feeRecipientMaxBps",receipt.blockNumber,[inner.fields.recipient]))===inner.fields.maxBps);
  }else if(inner.operation==="propose-controller"){
   const e=event("ControllerProposed"),notice=BigInt(await get<number|bigint>("NOTICE",receipt.blockNumber));need(peAfter===pe&&same(pending[0],viem.zeroAddress)&&same(e.next,inner.fields.incoming)&&String(e.expiresAt)===inner.fields.expiresAt&&BigInt(e.validAfter)===h.timestamp+notice&&e.epoch===ce&&same(pendingAfter[0],inner.fields.incoming)&&String(pendingAfter[2])===inner.fields.expiresAt);
  }else if(inner.operation==="cancel-controller"){
   const e=event("ControllerCancelled");need(peAfter===pe&&same(e.next,pending[0])&&e.epoch===ce&&same(pendingAfter[0],viem.zeroAddress));
  }else if(inner.operation==="accept-controller"){
   const e=event("ControllerChanged");need(same(e.previous,controller)&&same(e.next,safe)&&e.epoch===ceAfter);
  }
 }
 const gasCost=receipt.gasUsed*receipt.effectiveGasPrice;need(await rpc.getBalance({address:tx.from,blockNumber:receipt.blockNumber})+gasCost===await rpc.getBalance({address:tx.from,blockNumber:before}));
 need(same((await rpc.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash));
 return{blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash,timestamp:new Date(Number(h.timestamp)*1000).toISOString(),transactionHash:hash,transactionIndex:receipt.transactionIndex,status:receipt.status,vault:m.vault,projectToken:m.projectToken,safe,safeNonce:pre.nonce,safeNonceAfter:post.nonce,gasPayer:tx.from,gasPayerNonce:String(tx.nonce),gasCostWei:String(gasCost),digest,owners:pre.owners,signers:approvals.map(a=>a.signer),operation:inner.operation,fields:inner.fields,target:a[0],input:a[2],value:String(a[1]),outerInput:tx.input,proof};
}
export async function readSeaportSafeAdminReceipt(rpc:Rpc,m:SeaportVaultManifest,hash:Hash){
 try{return await verifyReceipt(rpc,m,hash);}catch(error){if(error instanceof UnsupportedSafeAdmin)return null;throw error;}
}
export function isSeaportSafeExecution(input:Hex){return input.slice(0,10).toLowerCase()===selector.toLowerCase();}
