import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, hashTypedData, parseAbi, zeroAddress,
  type Address, type Hash, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { reclaimCallerPins, verifyReclaimOrigin } from "./reclaim-fixture-origin.js";
import { reclaimCampaignSignatures } from "../../../packages/launchpad-common/reclaim-runtime.mjs";

/** Actual ECDSA test-key signatures against canonical-shaped provider doubles;
 * real Safe execution is separate synthetic-chain integration evidence. */
export async function testReclaimFixtureOrigins(){
  const archive=JSON.parse(readFileSync(new URL("../../../packages/contracts/test/fixtures/safe-1.4.1/runtime.json",import.meta.url),"utf8"));
  const proxy=JSON.parse(gunzipSync(readFileSync(new URL("../../../docs/evidence/mobile-signing/safe-runtime-4663.json.gz",import.meta.url))).toString()).proxyRuntimeCode as Hex;
  const owners=[1,2,3].map(n=>privateKeyToAccount(`0x${n.toString(16).padStart(64,"0")}` as Hex));
  const outsider=privateKeyToAccount(`0x${"04".padStart(64,"0")}`);
  const addr=(n:number)=>`0x${(0x2000000000000000000000000000000000000000n+BigInt(n)).toString(16)}` as Address;
  const h=(n:number)=>`0x${n.toString(16).padStart(64,"0")}` as Hash;
  const campaign=addr(1),safe=addr(2),payer=addr(3),hash=h(44078),blockHash=h(10),abi=parseAbi(reclaimCampaignSignatures);
  const safeAbi=parseAbi(["function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) payable returns(bool)",
    "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)","event ExecutionFailure(bytes32 indexed txHash,uint256 payment)"]);
  const data=encodeFunctionData({abi,functionName:"fund",args:[100n]}),nonce=21n;
  const types={SafeTx:[{name:"to",type:"address"},{name:"value",type:"uint256"},{name:"data",type:"bytes"},{name:"operation",type:"uint8"},
    {name:"safeTxGas",type:"uint256"},{name:"baseGas",type:"uint256"},{name:"gasPrice",type:"uint256"},{name:"gasToken",type:"address"},{name:"refundReceiver",type:"address"},{name:"nonce",type:"uint256"}]}as const;
  const typed={domain:{chainId:31337,verifyingContract:safe},types,primaryType:"SafeTx" as const,message:{to:campaign,value:0n,data,operation:0,safeTxGas:0n,baseGas:0n,gasPrice:0n,gasToken:zeroAddress,refundReceiver:zeroAddress,nonce}};
  const digest=hashTypedData(typed),signed=await Promise.all(owners.slice(0,2).map(async a=>({address:a.address,signature:await a.sign({hash:digest})})));
  const sorted=signed.sort((a,b)=>BigInt(a.address)<BigInt(b.address)?-1:1);
  const signatures=`0x${sorted.map(s=>s.signature.slice(2)).join("")}` as Hex;
  const knobs={mode:""};
  const outer=()=>encodeFunctionData({abi:safeAbi,functionName:"execTransaction",args:[knobs.mode==="redirect"?addr(99):campaign,0n,data,knobs.mode==="delegatecall"?1:0,0n,0n,0n,zeroAddress,zeroAddress,
    knobs.mode==="duplicate"?`0x${sorted[0]!.signature.slice(2).repeat(2)}`:knobs.mode==="reverse"?`0x${[...sorted].reverse().map(s=>s.signature.slice(2)).join("")}`:knobs.mode==="short"?sorted[0]!.signature:signatures]});
  const receipt=()=>({status:"success",transactionHash:hash,blockNumber:10n,blockHash,transactionIndex:0,to:safe,from:payer,
    logs:knobs.mode==="missing-success"?[]:[{address:safe,topics:encodeEventTopics({abi:safeAbi,eventName:knobs.mode==="failure"?"ExecutionFailure":"ExecutionSuccess",args:{txHash:knobs.mode==="digest"?h(99):digest}}),
      data:encodeAbiParameters([{type:"uint256"}],[knobs.mode==="payment"?1n:0n])}]});
  const header={number:10n,hash:blockHash,timestamp:1_800_000_000n,transactions:[hash]};
  const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
  const rpc={getChainId:async()=>31337,
    getTransaction:async()=>({chainId:31337,hash,blockNumber:10n,blockHash,transactionIndex:0,to:safe,from:payer,value:0n,nonce:4,input:outer()}),
    getTransactionCount:async()=>knobs.mode==="payer-nonce"?5:4,
    getCode:async({address}:{address:Address})=>same(address,safe)?knobs.mode==="proxy"?"0x6000":proxy:same(address,reclaimCallerPins.singleton)?archive.contracts.safe_l2.code
      :same(address,reclaimCallerPins.handler)?archive.contracts.compatibility_fallback_handler.code:knobs.mode==="contract-owner"&&same(address,owners[0]!.address)?"0x6000":undefined,
    getStorageAt:async({slot}:{slot:Hex})=>slot.startsWith("0x4a204")?`0x${(knobs.mode==="guard"?"1":"0").padStart(64,"0")}`:`0x${(knobs.mode==="handler"?addr(99):reclaimCallerPins.handler).slice(2).toLowerCase().padStart(64,"0")}`,
    readContract:async({functionName,blockNumber}:{functionName:string;blockNumber:bigint})=>{
      if(functionName==="VERSION")return"1.4.1";if(functionName==="masterCopy")return reclaimCallerPins.singleton;
      if(functionName==="getOwners")return knobs.mode==="outsider"?[owners[2]!.address,outsider.address,addr(99)]:owners.map(a=>a.address);
      if(functionName==="getThreshold")return knobs.mode==="threshold"?1n:2n;
      if(functionName==="nonce")return blockNumber===9n?nonce:knobs.mode==="stale"?nonce:nonce+1n;
      if(functionName==="getModulesPaginated")return[knobs.mode==="module"?[addr(99)]:[],"0x0000000000000000000000000000000000000001"];
      if(functionName==="getTransactionHash")return digest;throw Error("Unexpected Safe proof call");
    },
  }as unknown as PublicClient;
  const result=await verifyReclaimOrigin(rpc,receipt() as never,header as never,campaign,"fund",{controller:safe,amount:100n});
  assert.equal(result.profile,"safe-1.4.1");assert.equal(result.actor,safe);assert.equal(result.safeNonce,"21");assert.deepEqual(result.signers,sorted.map(s=>s.address));
  for(const mode of["payer-nonce","redirect","delegatecall","duplicate","reverse","short","missing-success","failure","digest","payment","proxy","contract-owner","guard","handler","outsider","threshold","stale","module","nonindexed-outcome"]){
    knobs.mode=mode;const observed=receipt();if(mode==="nonindexed-outcome"){observed.logs[0]!.topics=observed.logs[0]!.topics.slice(0,1)as never;observed.logs[0]!.data=encodeAbiParameters([{type:"bytes32"},{type:"uint256"}],[digest,0n]);}
    await assert.rejects(verifyReclaimOrigin(rpc,observed as never,header as never,campaign,"fund",{controller:safe,amount:100n}),/evidence|signature/i,mode);
  }
  console.info("Reclaim Safe origin, actual ECDSA owner signatures, envelope/nonce/custody-profile rejection smoke passed.");
}
