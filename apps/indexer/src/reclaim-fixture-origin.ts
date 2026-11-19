import { decodeFunctionData, encodeFunctionData, hashTypedData, keccak256, parseAbi, parseEventLogs,
  recoverAddress, zeroAddress, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { reclaimCampaignSignatures } from "../../../packages/launchpad-common/reclaim-runtime.mjs";

// The independent ERC-20/NFT settlement checks remain mandatory. These pins
// identify supported callers; they are not generic contract-wallet approval.
export const reclaimCallerPins = Object.freeze({
  safeProxyHash: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c" as Hash,
  singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762" as Address,
  singletonHash: "0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff" as Hash,
  handler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99" as Address,
  handlerHash: "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9" as Hash,
  delegate: "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B" as Address,
  designator: "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b" as Hex,
  delegateHash: "0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0" as Hash,
});
const guardSlot="0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8" as Hex;
const handlerSlot="0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5" as Hex;
const sentinel="0x0000000000000000000000000000000000000001" as Address;
const safeAbi=parseAbi(["function VERSION() view returns(string)","function masterCopy() view returns(address)",
  "function getOwners() view returns(address[])","function getThreshold() view returns(uint256)","function nonce() view returns(uint256)",
  "function getModulesPaginated(address,uint256) view returns(address[] array,address next)",
  "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns(bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool)",
  "event ExecutionSuccess(bytes32 txHash,uint256 payment)","event ExecutionFailure(bytes32 txHash,uint256 payment)"]);
const campaignAbi=parseAbi(reclaimCampaignSignatures);
const safeTypes={SafeTx:[{name:"to",type:"address"},{name:"value",type:"uint256"},{name:"data",type:"bytes"},{name:"operation",type:"uint8"},
  {name:"safeTxGas",type:"uint256"},{name:"baseGas",type:"uint256"},{name:"gasPrice",type:"uint256"},{name:"gasToken",type:"address"},
  {name:"refundReceiver",type:"address"},{name:"nonce",type:"uint256"}]} as const;
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
function must(x:unknown):asserts x {if(!x)throw Error("Fixture reclaim caller evidence unavailable or conflicting");}
const lowS=0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const wordAddress=(word:Hex|undefined)=>word&&/^0x0{24}[0-9a-f]{40}$/i.test(word)?`0x${word.slice(-40)}`:null;
const validDeadline=(value:unknown,at:bigint)=>typeof value==="number"&&Number.isSafeInteger(value)&&BigInt(value)>=at&&BigInt(value)<=at+300n;
type Receipt=Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>;
type Header=Awaited<ReturnType<PublicClient["getBlock"]>>;
export type ReclaimOrigin={profile:"eoa"|"metamask-7702"|"safe-1.4.1";actor:Address;gasPayer:Address;safeNonce?:string;safeTransactionHash?:Hash;signers?:Address[]};

async function directKind(rpc:PublicClient,who:Address,at:bigint):Promise<"eoa"|"metamask-7702">{
  const raw=await rpc.getCode({address:who,blockNumber:at});
  must(raw===undefined||typeof raw==="string"&&/^0x(?:[0-9a-f]{2})*$/i.test(raw));
  if(raw===undefined||raw==="0x")return"eoa";
  must(same(raw,reclaimCallerPins.designator));
  const code=await rpc.getCode({address:reclaimCallerPins.delegate,blockNumber:at});
  must(code&&same(keccak256(code),reclaimCallerPins.delegateHash));return"metamask-7702";
}
function reviewedCall(data:Hex,kind:"fund"|"recover"|"trade-in"|"return",args:Record<string,unknown>,timestamp:bigint){
  must(/^0x(?:[0-9a-f]{2}){4,65536}$/i.test(data));
  const decoded=decodeFunctionData({abi:campaignAbi,data});
  must(same(encodeFunctionData({abi:campaignAbi,functionName:decoded.functionName,args:decoded.args as never}),data));
  const a=decoded.args as readonly unknown[];
  if(kind==="fund")must(decoded.functionName==="fund"&&a[0]===args.amount);
  else if(kind==="recover")must(decoded.functionName==="executeRecovery");
  else if(kind==="return")must(decoded.functionName==="returnTradeIn"&&a[0]===args.receiptId&&validDeadline(a[1],timestamp));
  else {must(decoded.functionName==="redeem"&&same(String(a[0]),String(args.collection))&&JSON.stringify(a[1],(_,v)=>typeof v==="bigint"?v.toString():v)===JSON.stringify(args.ids,(_,v)=>typeof v==="bigint"?v.toString():v)
    &&JSON.stringify(a[2],(_,v)=>typeof v==="bigint"?v.toString():v)===JSON.stringify(args.quantities,(_,v)=>typeof v==="bigint"?v.toString():v)
    &&a[5]===args.policyEpoch&&a[6]===args.reward&&a[7]===args.claimantNonce&&validDeadline(a[8],timestamp));}
}

/** Supports a single exact zero-native CALL, not arbitrary Safe modules,
 * contract signatures, delegatecalls, multisends, or refund relayers. The
 * receipt and block must already have passed canonical membership checks. */
export async function verifyReclaimOrigin(rpc:PublicClient,receipt:Receipt,header:Header,campaign:Address,kind:"fund"|"recover"|"trade-in"|"return",args:Record<string,unknown>):Promise<ReclaimOrigin>{
  must(receipt.blockNumber>0n&&header.transactions.length===1&&receipt.transactionIndex===0&&await rpc.getChainId()===31337);
  const tx=await rpc.getTransaction({hash:receipt.transactionHash}),before=receipt.blockNumber-1n;
  must(tx.chainId===31337&&tx.to&&same(tx.hash,receipt.transactionHash)&&same(tx.blockHash??"",receipt.blockHash)
    &&tx.blockNumber===receipt.blockNumber&&tx.transactionIndex===0&&receipt.to&&same(tx.to,receipt.to)&&receipt.from&&same(tx.from,receipt.from)&&tx.value===0n
    &&/^0x(?:[0-9a-f]{2}){4,70000}$/i.test(tx.input));
  const actor=kind==="fund"?args.controller:kind==="recover"?null:args.claimant;
  const payerKind=await directKind(rpc,tx.from,before);must(await directKind(rpc,tx.from,receipt.blockNumber)===payerKind);
  must(tx.nonce===await rpc.getTransactionCount({address:tx.from,blockNumber:before}));
  if(same(tx.to,campaign)){
    must(!actor||typeof actor==="string"&&same(tx.from,actor));reviewedCall(tx.input,kind,args,header.timestamp);
    return{profile:payerKind,actor:tx.from,gasPayer:tx.from};
  }
  const safe=tx.to;must(!actor||typeof actor==="string"&&same(safe,actor));
  const decoded=decodeFunctionData({abi:safeAbi,data:tx.input});must(decoded.functionName==="execTransaction");
  const a=decoded.args as readonly[Address,bigint,Hex,number,bigint,bigint,bigint,Address,Address,Hex];
  must(same(a[0],campaign)&&a[1]===0n&&a[3]===0&&a[4]===0n&&a[5]===0n&&a[6]===0n&&same(a[7],zeroAddress)&&same(a[8],zeroAddress)
    &&/^0x[0-9a-f]{260}$/i.test(a[9])&&same(encodeFunctionData({abi:safeAbi,functionName:"execTransaction",args:a}),tx.input));
  reviewedCall(a[2],kind,args,header.timestamp);
  const read=(name:string,height:bigint,args:readonly unknown[]=[])=>rpc.readContract({address:safe,abi:safeAbi,functionName:name,args,blockNumber:height}as never);
  const[codePre,codePost,singletonCode,handlerCode,version,singleton,owners,ownersPost,threshold,thresholdPost,nonce,noncePost,modules,modulesPost,guard,guardPost,handler,handlerPost]=await Promise.all([
    rpc.getCode({address:safe,blockNumber:before}),rpc.getCode({address:safe,blockNumber:receipt.blockNumber}),rpc.getCode({address:reclaimCallerPins.singleton,blockNumber:before}),rpc.getCode({address:reclaimCallerPins.handler,blockNumber:before}),
    read("VERSION",before),read("masterCopy",before),read("getOwners",before),read("getOwners",receipt.blockNumber),read("getThreshold",before),read("getThreshold",receipt.blockNumber),read("nonce",before),read("nonce",receipt.blockNumber),
    read("getModulesPaginated",before,[sentinel,1n]),read("getModulesPaginated",receipt.blockNumber,[sentinel,1n]),rpc.getStorageAt({address:safe,slot:guardSlot,blockNumber:before}),rpc.getStorageAt({address:safe,slot:guardSlot,blockNumber:receipt.blockNumber}),
    rpc.getStorageAt({address:safe,slot:handlerSlot,blockNumber:before}),rpc.getStorageAt({address:safe,slot:handlerSlot,blockNumber:receipt.blockNumber})]);
  must(codePre&&codePost&&same(codePre,codePost)&&same(keccak256(codePre),reclaimCallerPins.safeProxyHash)&&singletonCode&&same(keccak256(singletonCode),reclaimCallerPins.singletonHash)
    &&handlerCode&&same(keccak256(handlerCode),reclaimCallerPins.handlerHash)&&version==="1.4.1"&&typeof singleton==="string"&&same(singleton,reclaimCallerPins.singleton)
    &&threshold===2n&&thresholdPost===2n&&typeof nonce==="bigint"&&noncePost===nonce+1n&&Array.isArray(owners)&&owners.length===3&&new Set(owners.map(x=>String(x).toLowerCase())).size===3
    &&JSON.stringify(owners)===JSON.stringify(ownersPost)&&[modules,modulesPost].every(m=>Array.isArray(m)&&Array.isArray(m[0])&&m[0].length===0&&typeof m[1]==="string"&&same(m[1],sentinel))
    &&[guard,guardPost].every(g=>g!==undefined&&/^0x0{64}$/i.test(g))&&same(wordAddress(handler)??"",reclaimCallerPins.handler)&&same(wordAddress(handlerPost)??"",reclaimCallerPins.handler));
  for(const owner of owners){must(typeof owner==="string"&&/^0x[0-9a-f]{40}$/i.test(owner)&&BigInt(owner)>0xffffn);must(await directKind(rpc,owner as Address,before)==="eoa");}
  const message={to:a[0],value:a[1],data:a[2],operation:a[3],safeTxGas:a[4],baseGas:a[5],gasPrice:a[6],gasToken:a[7],refundReceiver:a[8],nonce};
  const digest=hashTypedData({domain:{chainId:31337,verifyingContract:safe},types:safeTypes,primaryType:"SafeTx",message});
  must(same(String(await read("getTransactionHash",before,[...a.slice(0,9),nonce])),digest));
  const signers:Address[]=[];
  for(let i=0;i<2;i++){const signature=`0x${a[9].slice(2+i*130,2+(i+1)*130)}` as Hex,v=parseInt(signature.slice(-2),16),s=BigInt(`0x${signature.slice(66,130)}`);
    must((v===27||v===28)&&s>0n&&s<=lowS);const signer=await recoverAddress({hash:digest,signature});must(owners.some(x=>typeof x==="string"&&same(x,signer))&&(i===0||BigInt(signer)>BigInt(signers[i-1]!)));signers.push(signer);}
  const result=parseEventLogs({abi:safeAbi,strict:true,logs:receipt.logs.filter(l=>same(l.address,safe))});
  const outcomes=result.filter(l=>l.eventName==="ExecutionSuccess"||l.eventName==="ExecutionFailure");
  must(outcomes.length===1&&outcomes[0]!.eventName==="ExecutionSuccess"&&same(outcomes[0]!.args.txHash,digest)&&outcomes[0]!.args.payment===0n);
  return{profile:"safe-1.4.1",actor:safe,gasPayer:tx.from,safeNonce:nonce.toString(),safeTransactionHash:digest,signers};
}
