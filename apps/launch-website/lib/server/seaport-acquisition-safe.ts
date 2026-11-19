import * as viem from "viem";
import {compileSeaportSafeCall,readSeaportSafeState,safeAuthorityIdentity,seaportSafeVaultSignatures} from "../../../../packages/launchpad-common/seaport-vault-safe.mjs";
import {seaportLocalContext,readSeaportIndex,type SeaportLocalConfig} from "./seaport-acquisition";
import {projectTreasuryControllerKind} from "./project-treasury-fixture";
import {claimProfileDigest} from "../claim-profiles";
import {seaportSafeProfile,seaportSafeOperations,seaportSafeAbi,seaportSafeTyped,seaportSafeProposalHash,seaportSafeOuterHash,validSeaportSafeProposal,validSeaportSafeOuter,verifySafeOwnerApproval,verifySafeOwnerApprovals,canonicalSeaportSafeApprovals,safeExecutionData,type SeaportSafeProposal,type SeaportSafeApproval,type SeaportSafeOuterReview,type SeaportSafeOperation,type SeaportSafeFields,type SeaportSafeVerification} from "../seaport-acquisition-safe";
type Address=viem.Address;type Hex=viem.Hex;
const same=(a:unknown,b:unknown)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const address=(v:unknown):v is Address=>typeof v==="string"&&/^0x[0-9a-f]{40}$/i.test(v)&&BigInt(v)>0xffffn;
const need=(v:unknown)=>{if(!v)throw Error("Exact Safe administration evidence unavailable or conflicting");};
const vaultAbi=viem.parseAbi(seaportSafeVaultSignatures);
const ownerSet=(owners:readonly string[])=>JSON.stringify(owners.map(x=>x.toLowerCase()).sort());
type Context=Awaited<ReturnType<typeof seaportLocalContext>>;
type Rpc=Context["rpc"];
const at=(x:Context)=>({address:x.m.vault,abi:vaultAbi,blockNumber:x.head.number}as const);
async function payerState(x:Context,payer:Address){
 const kind=await projectTreasuryControllerKind(x.rpc,payer,x.head.number);need(kind==="eoa"||kind==="metamask-7702");
 const code=await x.rpc.getCode({address:payer,blockNumber:x.head.number}),pending=await x.rpc.getCode({address:payer,blockTag:"pending"});need(same(code??"0x",pending??"0x"));
 return{kind,codeHash:viem.keccak256(code??"0x"),nonce:await x.rpc.getTransactionCount({address:payer,blockTag:"pending"})};
}
const safeHashArgs=(p:SeaportSafeProposal)=>[p.safeTx.to,BigInt(p.safeTx.value),p.safeTx.data,0,0n,0n,0n,viem.zeroAddress,viem.zeroAddress,BigInt(p.safeNonce)]as const;
async function safeState(x:Context,safe:Address){
 const mined=await readSeaportSafeState(x.rpc,safe,x.head.number,viem),pending=await readSeaportSafeState(x.rpc,safe,"pending",viem);
 need(safeAuthorityIdentity(mined)===safeAuthorityIdentity(pending)&&mined.nonce===pending.nonce);return mined;
}
async function terms(x:Context,safe:Address,operation:SeaportSafeOperation,fields:SeaportSafeFields){
 const call=compileSeaportSafeCall(x.m,operation,fields,viem),read=async<T>(functionName:string,args:readonly unknown[]=[])=>x.rpc.readContract({...at(x),functionName,args}as never)as Promise<T>;
 const notice=await read<readonly[Address,number,number,bigint]>("pendingController");
 if(operation==="accept-controller")need(same(notice[0],safe)&&notice[3]===x.controllerEpoch&&BigInt(notice[1])<=x.head.timestamp&&BigInt(notice[2])>=x.head.timestamp&&notice[1]>0);
 else need(same(x.controller,safe));
 if(operation==="configure-collection"||operation==="configure-fee-recipient")need(!x.enabled);
 if(operation==="propose-controller"){
  need(!same(fields.incoming,safe)&&!same(fields.incoming,x.m.vault)&&!same(fields.incoming,x.m.seaport)&&same(notice[0],viem.zeroAddress));
  const kind=await projectTreasuryControllerKind(x.rpc,viem.getAddress(String(fields.incoming)),x.head.number);need(["eoa","metamask-7702","safe-1.4.1"].includes(kind));
  const n=BigInt(await read<bigint|number>("NOTICE")),window=BigInt(await read<bigint|number>("WINDOW")),expiry=BigInt(String(fields.expiresAt));need(expiry>x.head.timestamp+n&&expiry<=x.head.timestamp+n+window);
 }
 if(operation==="fund-native")need(await x.rpc.getBalance({address:safe,blockTag:"pending"})>=BigInt(call.value));
 if(operation==="fund-token"||operation==="approve-funding"){
  const allowance=await x.rpc.readContract({address:x.m.paymentToken,abi:viem.erc20Abi,functionName:"allowance",args:[safe,x.m.vault],blockTag:"pending"});
  if(operation==="approve-funding")need(allowance===0n);
  else need(allowance===BigInt(String(fields.amountWei))&&await x.rpc.readContract({address:x.m.paymentToken,abi:viem.erc20Abi,functionName:"balanceOf",args:[safe],blockTag:"pending"})>=BigInt(String(fields.amountWei)));
 }
 const code=await x.rpc.getCode({address:call.to,blockNumber:x.head.number}),pendingCode=await x.rpc.getCode({address:call.to,blockTag:"pending"});
 need(code&&pendingCode&&same(viem.keccak256(code),call.runtimeHash)&&same(code,pendingCode));
 await x.rpc.call({account:safe,to:call.to,data:call.data,value:BigInt(call.value),blockTag:"pending"});return call;
}
async function current(c:SeaportLocalConfig,p:SeaportSafeProposal){
 need(validSeaportSafeProposal(p));const x=await seaportLocalContext(c);
 need(same(x.m.vault,p.vault)&&same(x.m.projectToken,p.projectToken)&&same(x.controller,p.controller)&&String(x.controllerEpoch)===p.controllerEpoch&&String(x.policyEpoch)===p.policyEpoch
  &&x.head.timestamp<BigInt(p.expiresAt)&&same((await x.rpc.getBlock({blockNumber:BigInt(p.observed.blockNumber)})).hash,p.observed.blockHash));
 const [state,payer]=await Promise.all([safeState(x,p.safe),payerState(x,p.gasPayer)]);
 need(state.nonce===p.safeNonce&&ownerSet(state.owners)===ownerSet(p.owners)&&BigInt(p.gasPayerNonce)===BigInt(payer.nonce));
 const call=await terms(x,p.safe,p.operation,p.fields);need(same(call.to,p.call.to)&&same(call.data,p.call.data)&&call.value===p.call.value&&same(call.runtimeHash,p.call.runtimeHash));
 need(same(await x.rpc.readContract({address:p.safe,abi:seaportSafeAbi,functionName:"getTransactionHash",args:safeHashArgs(p),blockNumber:x.head.number}as never),p.digest));
 return{x,state,payer};
}
export async function proposeSeaportSafe(c:SeaportLocalConfig,body:Record<string,unknown>):Promise<SeaportSafeProposal>{
 need(address(body.safe)&&address(body.gasPayer)&&!same(body.safe,body.gasPayer)&&seaportSafeOperations.includes(body.operation as SeaportSafeOperation)&&body.fields&&typeof body.fields==="object"&&!Array.isArray(body.fields));
 const x=await seaportLocalContext(c),safe=viem.getAddress(body.safe as Address),gasPayer=viem.getAddress(body.gasPayer as Address),operation=body.operation as SeaportSafeOperation,fields=body.fields as SeaportSafeFields;
 const[state,payer]=await Promise.all([safeState(x,safe),payerState(x,gasPayer)]),call=await terms(x,safe,operation,fields),expiresAt=Number(x.head.timestamp)+180;
 const safeTx={to:call.to,value:call.value,data:call.data,operation:0 as const,safeTxGas:"0" as const,baseGas:"0" as const,gasPrice:"0" as const,gasToken:viem.zeroAddress,refundReceiver:viem.zeroAddress,nonce:state.nonce};
 const partial={schemaVersion:1 as const,profile:seaportSafeProfile,chainId:31337 as const,scope:"synthetic-local" as const,productionExecution:false as const,status:"awaiting-safe-approvals" as const,
  operation,fields,vault:x.m.vault,projectToken:x.m.projectToken,safe,owners:state.owners,threshold:2 as const,safeNonce:state.nonce,gasPayer,gasPayerNonce:String(payer.nonce),controller:x.controller,controllerEpoch:String(x.controllerEpoch),policyEpoch:String(x.policyEpoch),call,safeTx,
  digest:viem.hashTypedData({domain:{chainId:31337,verifyingContract:safe},types:{SafeTx:[{name:"to",type:"address"},{name:"value",type:"uint256"},{name:"data",type:"bytes"},{name:"operation",type:"uint8"},{name:"safeTxGas",type:"uint256"},{name:"baseGas",type:"uint256"},{name:"gasPrice",type:"uint256"},{name:"gasToken",type:"address"},{name:"refundReceiver",type:"address"},{name:"nonce",type:"uint256"}]},primaryType:"SafeTx",message:safeTx}as never),
  observed:{blockNumber:String(x.head.number),blockHash:x.head.hash!,timestamp:new Date(Number(x.head.timestamp)*1000).toISOString()},expiresAt};
 const p={...partial,proposalHash:seaportSafeProposalHash(partial)};need(validSeaportSafeProposal(p));await current(c,p);return p;
}
export async function validateSeaportSafeOwner(c:SeaportLocalConfig,p:SeaportSafeProposal,approval?:SeaportSafeApproval){
 await current(c,p);if(approval)need(await verifySafeOwnerApproval(p,approval));return{status:approval?"approved":"current",proposalHash:p.proposalHash,...(approval&&{signer:approval.signer}),productionExecution:false};
}
export async function prepareSeaportSafeOuter(c:SeaportLocalConfig,p:SeaportSafeProposal,approvals:SeaportSafeApproval[],prior?:SeaportSafeOuterReview):Promise<SeaportSafeOuterReview>{
 const{x,payer}=await current(c,p),ordered=canonicalSeaportSafeApprovals(approvals);need(await verifySafeOwnerApprovals(p,ordered));
 const data=safeExecutionData(p,ordered),simulation=await x.rpc.call({account:p.gasPayer,to:p.safe,data,value:0n,blockTag:"pending"});
 need(simulation.data&&viem.decodeFunctionResult({abi:seaportSafeAbi,functionName:"execTransaction",data:simulation.data})===true);
 const[estimate,priority,head]=await Promise.all([x.rpc.estimateGas({account:p.gasPayer,to:p.safe,data,value:0n}),x.rpc.estimateMaxPriorityFeePerGas(),x.rpc.getBlock()]);
 const gas=estimate*125n/100n,fee=(head.baseFeePerGas??0n)*2n+priority;need(gas>0n&&gas<=20_000_000n&&fee>0n);
 let request={type:"0x2" as const,chainId:"0x7a69" as const,from:p.gasPayer,to:p.safe,data,value:"0x0" as const,nonce:viem.toHex(payer.nonce),gas:viem.toHex(gas),maxFeePerGas:viem.toHex(fee),maxPriorityFeePerGas:viem.toHex(priority)};
 if(prior){need(validSeaportSafeOuter(prior)&&prior.proposal.proposalHash===p.proposalHash&&claimProfileDigest(prior.approvals)===claimProfileDigest(ordered)&&same(prior.gasPayerCodeHash,payer.codeHash)&&estimate<=BigInt(prior.request.gas)&&(head.baseFeePerGas??0n)+priority<=BigInt(prior.request.maxFeePerGas));request=prior.request as typeof request;}
 const maximumNetworkFeeWei=String(BigInt(request.gas)*BigInt(request.maxFeePerGas));need(await x.rpc.getBalance({address:p.gasPayer,blockTag:"pending"})>=BigInt(maximumNetworkFeeWei));
 const partial={schemaVersion:1 as const,profile:seaportSafeProfile,chainId:31337 as const,productionExecution:false as const,status:"prepared" as const,proposal:p,approvals:ordered,request,gasPayerCodeHash:payer.codeHash,maximumNetworkFeeWei},review={...partial,reviewHash:seaportSafeOuterHash(partial)};
 need(validSeaportSafeOuter(review)&&(!prior||review.reviewHash===prior.reviewHash));return review;
}
function exactOuter(t:Record<string,unknown>,r:SeaportSafeOuterReview){
 const q=r.request;return same(t.from,q.from)&&same(t.to,q.to)&&same(t.input,q.data)&&t.chainId===31337&&t.type==="eip1559"&&BigInt(String(t.nonce))===BigInt(q.nonce)&&t.value===0n&&t.gas===BigInt(q.gas)&&t.maxFeePerGas===BigInt(q.maxFeePerGas)&&t.maxPriorityFeePerGas===BigInt(q.maxPriorityFeePerGas)&&t.authorizationList==null&&(t.accessList==null||Array.isArray(t.accessList)&&t.accessList.length===0);
}
async function findOuter(rpc:Rpc,birth:string,r:SeaportSafeOuterReview):Promise<Hex|undefined>{
 const deadline=Date.now()+8000;const read=async<T>(fn:()=>Promise<T>)=>{const left=deadline-Date.now();need(left>0);let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([fn(),new Promise<never>((_,fail)=>{timer=setTimeout(()=>fail(Error("Safe original nonce read budget exhausted")),left);})]);}finally{if(timer)clearTimeout(timer);}};
 const head=await read(()=>rpc.getBlock()),first=BigInt(birth);need(head.number!==null&&head.hash&&head.number>=first&&head.number-first<4096n);
 for(let height=head.number!;height>=first;height--){const block=await read(()=>rpc.getBlock({blockNumber:height,includeTransactions:true}));need(block.hash&&block.transactions.length<=32);
  for(let index=0;index<block.transactions.length;index++){const tx=block.transactions[index]!;if(!same(tx.from,r.proposal.gasPayer)||BigInt(tx.nonce)!==BigInt(r.request.nonce))continue;
   if(!exactOuter(tx as unknown as Record<string,unknown>,r))return;const receipt=await read(()=>rpc.getTransactionReceipt({hash:tx.hash}));
   need(tx.transactionIndex===index&&same(tx.blockHash,block.hash)&&receipt.transactionIndex===index&&same(receipt.blockHash,block.hash)&&same((await read(()=>rpc.getBlock({blockNumber:head.number!}))).hash,head.hash));return tx.hash;
  }
 }
}
export async function verifySeaportSafeOuter(c:SeaportLocalConfig,r:SeaportSafeOuterReview,hint?:Hex):Promise<SeaportSafeVerification>{
 const p=r.proposal,base={schemaVersion:1 as const,profile:seaportSafeProfile,chainId:31337 as const,productionExecution:false as const,reviewHash:r.reviewHash,proposalHash:p.proposalHash,safe:p.safe,safeNonce:p.safeNonce,gasPayer:p.gasPayer,vault:p.vault};
 try{
  need(validSeaportSafeOuter(r)&&await verifySafeOwnerApprovals(p,r.approvals));const x=await seaportLocalContext(c),call=compileSeaportSafeCall(x.m,p.operation,p.fields,viem);
  need(same(p.vault,x.m.vault)&&same(p.projectToken,x.m.projectToken)&&same(call.to,p.call.to)&&same(call.data,p.call.data)&&call.value===p.call.value&&same(call.runtimeHash,p.call.runtimeHash));
  const hash=hint??await findOuter(x.rpc,c.manifest.deployment.blockNumber,r);if(!hash)return{...base,status:"pending",reason:"Original Safe outer transaction not yet found; no resubmission authorized"};
  const [tx,receipt]=await Promise.all([x.rpc.getTransaction({hash}),x.rpc.getTransactionReceipt({hash})]),header=await x.rpc.getBlock({blockNumber:receipt.blockNumber});
  need(exactOuter(tx as unknown as Record<string,unknown>,r)&&same(tx.hash,hash)&&same(receipt.transactionHash,hash)&&same(receipt.from,p.gasPayer)&&same(receipt.to,p.safe)&&tx.blockNumber===receipt.blockNumber&&tx.transactionIndex===receipt.transactionIndex&&same(header.transactions[receipt.transactionIndex],hash));
  if(!same(header.hash,receipt.blockHash)||!same(tx.blockHash,receipt.blockHash))return{...base,status:"reorged",transactionHash:hash};
  let indexed;try{indexed=await readSeaportIndex(c,hash);}catch{return{...base,status:"pending",transactionHash:hash,reason:"Exact durable Safe authority, receipt and trace evidence pending"};}
  const rows=(indexed.adminEvents??[]).filter((row:Record<string,unknown>)=>same(row.transactionHash,hash));need(rows.length===1);const row=rows[0];
  need(same(row.safe,p.safe)&&same(row.gasPayer,p.gasPayer)&&row.safeNonce===p.safeNonce&&same(row.digest,p.digest)&&row.operation===p.operation
   &&same(row.target,p.call.to)&&same(row.input,p.call.data)&&row.value===p.call.value&&ownerSet(row.owners)===ownerSet(p.owners)
   &&ownerSet(row.signers)===ownerSet(r.approvals.map(a=>a.signer))&&row.blockNumber===String(receipt.blockNumber)&&same(row.blockHash,receipt.blockHash)
   &&same(viem.keccak256((await x.rpc.getCode({address:p.gasPayer,blockNumber:receipt.blockNumber}))??"0x"),r.gasPayerCodeHash));
  need(row.status===receipt.status&&same((await x.rpc.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash));
  return{...base,status:receipt.status==="success"?"confirmed":"reverted",transactionHash:hash,indexed:true,canonical:{blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash}};
 }catch{return{...base,status:"pending",...(hint&&{transactionHash:hint}),reason:"Original Safe authority, canonical receipt or trace is unavailable; no signing or resubmission"};}
}

export async function seaportSafeAdminSnapshot(c:SeaportLocalConfig,x:Context){
 const pending=await x.rpc.readContract({...at(x),functionName:"pendingController"}as never)as readonly[Address,number,number,bigint];
 const candidate=!same(pending[0],viem.zeroAddress)?pending[0]:await projectTreasuryControllerKind(x.rpc,x.controller,x.head.number)==="safe-1.4.1"?x.controller:c.manifest.safeSeller?.address;
 let state:Awaited<ReturnType<typeof readSeaportSafeState>>|null=null;if(candidate)try{state=await readSeaportSafeState(x.rpc,candidate,x.head.number,viem);}catch{}
 return{profile:seaportSafeProfile,creatorCreate:"UNAVAILABLE",candidateSafe:state?.safe??null,owners:state?.owners??[],threshold:state?.threshold??null,safeNonce:state?.nonce??null,
  pendingController:same(pending[0],viem.zeroAddress)?null:{next:pending[0],validAfter:String(pending[1]),expiresAt:String(pending[2]),epoch:String(pending[3])},
  observed:{timestamp:new Date(Number(x.head.timestamp)*1000).toISOString()},feeRecipient:c.manifest.fee??null,paymentToken:c.manifest.paymentToken,operations:seaportSafeOperations,productionExecution:false};
}
