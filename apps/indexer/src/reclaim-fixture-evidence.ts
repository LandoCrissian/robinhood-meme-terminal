import {readFileSync,statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {decodeEventLog,erc20Abi,keccak256,parseAbi,parseAbiItem,parseEventLogs,type Address,type Hash,type PublicClient} from "viem";
import {materializeReclaimRuntime,reclaimFactorySignatures,reclaimCampaignSignatures,buildReclaimEligibility} from "../../../packages/launchpad-common/reclaim-runtime.mjs";
import {assertFixtureTreasuryReceiptLog as assertCanonicalReceiptLog,type FixtureTreasuryProofLog} from "./project-treasury-fixture-store.js";
import type {BlockEvidence,CurveFixtureBinding} from "./curve-launch-evidence.js";
import {storedReclaimFixtureBirths} from "./reclaim-fixture-store.js";
import {reclaimFixtureProfile,type ReclaimFixtureModule,type ReclaimFixtureBirth,type ReclaimFixtureEvent,type ReclaimFixtureSnapshot,
  type ReclaimFixtureScope,type ReclaimFixtureRange} from "./reclaim-fixture-types.js";
import type{Client}from"pg";

const factoryAbi=parseAbi(reclaimFactorySignatures),campaignAbi=parseAbi(reclaimCampaignSignatures);
const birthEvent=parseAbiItem("event CampaignCreated(address indexed creator,address indexed campaign,bytes32 indexed intent,address controller,uint128 rewardPerUnit,uint32 walletCap)");
const nftAbi=parseAbi(["function ownerOf(uint256) view returns(address)","function balanceOf(address,uint256) view returns(uint256)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)",
  "event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values)"]);
const coreAbi=parseAbi(["function originCurveForToken(address) view returns(address)"]);
const curveAbi=parseAbi(["function token() view returns(address)","function factory() view returns(address)"]);
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const addr=(v:unknown):v is Address=>typeof v==="string"&&/^0x[0-9a-f]{40}$/i.test(v)&&BigInt(v)>0xffffn;
const hash=(v:unknown):v is Hash=>typeof v==="string"&&/^0x[0-9a-f]{64}$/i.test(v)&&BigInt(v)>0n;
const stringify=(v:unknown)=>JSON.stringify(v,(_,x)=>typeof x==="bigint"?x.toString():x);
export function requireReclaimEvidence(value:unknown):asserts value {if(!value)throw Error("Fixture reclaim evidence unavailable or conflicting");}
async function read<T>(rpc:PublicClient,address:Address,factory:boolean,name:string,args:readonly unknown[],height:bigint):Promise<T>{
  return rpc.readContract({address,abi:factory?factoryAbi:campaignAbi,functionName:name,args,blockNumber:height}as never)as Promise<T>;
}
export function configuredReclaimFixtureModule(env:NodeJS.ProcessEnv,binding:CurveFixtureBinding):ReclaimFixtureModule|null{
  if(!env.RMT_RECLAIM_FIXTURE&&!env.RMT_RECLAIM_DEPLOYMENT)return null;
  if(env.RMT_RECLAIM_FIXTURE!=="local-reviewed-reclaim-v1"||env.NETLIFY||env.RAILWAY_ENVIRONMENT_ID||env.VERCEL||env.DEPLOY_ID||env.CONTEXT)throw Error("Fixture reclaim profile is disabled or hosted");
  const file=env.RMT_RECLAIM_DEPLOYMENT;requireReclaimEvidence(file&&isAbsolute(file)&&statSync(file).size<=180_000);
  const m=JSON.parse(readFileSync(file!,"utf8"))as ReclaimFixtureModule;
  requireReclaimEvidence(m.schemaVersion===1&&m.profile===reclaimFixtureProfile&&m.chainId===31337
    &&[m.reclaimFactory,m.coreFactory,m.rewardToken].every(addr)
    &&[m.factoryRuntimeHash,m.coreFactoryRuntimeHash,m.rewardTokenRuntimeHash,m.campaignCreationCodeHash,m.deployment.transactionHash,m.deployment.blockHash].every(hash)
    &&same(m.coreFactory,binding.factory)&&same(m.coreFactoryRuntimeHash,binding.factoryRuntimeHash)
    &&/^[1-9][0-9]{0,15}$/.test(m.deployment.blockNumber)&&BigInt(m.deployment.blockNumber)>=binding.deploymentBlock
    &&/^[0-9a-f]{64}$/.test(m.compilerInputSha256)&&/^0x(?:[0-9a-f]{2}){1,49152}$/i.test(m.campaignCreationCode)
    &&same(keccak256(m.campaignCreationCode),m.campaignCreationCodeHash)
    &&Array.isArray(m.collections)&&m.collections.length>0&&m.collections.length<=16
    &&new Set(m.collections.map(c=>c.address.toLowerCase())).size===m.collections.length);
  for(const c of m.collections){requireReclaimEvidence(addr(c.address)&&hash(c.runtimeHash)&&[1,2].includes(c.standard));
    // Shape/uniqueness only; this does not admit a real collection or market.
    buildReclaimEligibility({chainId:31337,campaign:m.reclaimFactory,collection:c.address,runtimeHash:c.runtimeHash,standard:c.standard,items:c.items},
      {keccak256,encodeAbiParameters:(types,values)=>importEncoder(types,values)});
  }
  materializeReclaimRuntime(m.campaignRuntimeTemplate,m.campaignImmutableReferences,m.campaignImmutableNames,
    {creator:m.coreFactory,rewardToken:m.rewardToken,rewardRuntimeHash:m.rewardTokenRuntimeHash,deploymentChainId:31337,deploymentFactory:m.reclaimFactory});
  return m;
}
// Kept outside the pure shared helper; this is the existing pinned viem codec.
import {encodeAbiParameters} from "viem";
function importEncoder(types:readonly{type:string}[],values:readonly unknown[]){return encodeAbiParameters(types as never,values as never);}

export async function verifyReclaimFixtureModule(rpc:PublicClient,m:ReclaimFixtureModule){
  const height=BigInt(m.deployment.blockNumber);
  const[chain,code,tokenCode,coreCode,receipt,header,token,tokenHash,chainBinding,creationHash,supply,decimals,origin]=await Promise.all([
    rpc.getChainId(),rpc.getCode({address:m.reclaimFactory,blockNumber:height}),rpc.getCode({address:m.rewardToken,blockNumber:height}),rpc.getCode({address:m.coreFactory,blockNumber:height}),
    rpc.getTransactionReceipt({hash:m.deployment.transactionHash}),rpc.getBlock({blockNumber:height}),
    read<Address>(rpc,m.reclaimFactory,true,"rewardToken",[],height),read<Hash>(rpc,m.reclaimFactory,true,"rewardRuntimeHash",[],height),
    read<bigint>(rpc,m.reclaimFactory,true,"deploymentChainId",[],height),read<Hash>(rpc,m.reclaimFactory,true,"campaignCreationCodeHash",[],height),
    rpc.readContract({address:m.rewardToken,abi:erc20Abi,functionName:"totalSupply",blockNumber:height}),
    rpc.readContract({address:m.rewardToken,abi:erc20Abi,functionName:"decimals",blockNumber:height}),
    rpc.readContract({address:m.coreFactory,abi:coreAbi,functionName:"originCurveForToken",args:[m.rewardToken],blockNumber:height}),
  ]);
  const at={blockNumber:m.deployment.blockNumber,blockHash:m.deployment.blockHash,timestamp:new Date(Number(header.timestamp)*1000).toISOString()};
  requireReclaimEvidence(chain===31337&&code&&same(keccak256(code),m.factoryRuntimeHash)&&tokenCode&&same(keccak256(tokenCode),m.rewardTokenRuntimeHash)
    &&coreCode&&same(keccak256(coreCode),m.coreFactoryRuntimeHash)&&receipt.status==="success"&&receipt.to===null&&receipt.contractAddress&&same(receipt.contractAddress,m.reclaimFactory)
    &&same(token,m.rewardToken)&&same(tokenHash,m.rewardTokenRuntimeHash)&&chainBinding===31337n&&same(creationHash,m.campaignCreationCodeHash)
    &&supply===1_000_000_000n*10n**18n&&decimals===18&&addr(origin));
  // A constructor may emit no logs; bind its actual successful CREATE receipt
  // and canonical transaction membership directly, without inventing an event.
  requireReclaimEvidence(header.number===height&&header.hash&&same(header.hash,at.blockHash)&&same(receipt.blockHash,at.blockHash)
    &&receipt.blockNumber===height&&same(receipt.transactionHash,m.deployment.transactionHash)
    &&same(header.transactions[receipt.transactionIndex]as Hash,m.deployment.transactionHash));
  const[registeredToken,registeredFactory]=await Promise.all([
    rpc.readContract({address:origin,abi:curveAbi,functionName:"token",blockNumber:height}),
    rpc.readContract({address:origin,abi:curveAbi,functionName:"factory",blockNumber:height})]);
  requireReclaimEvidence(same(registeredToken,m.rewardToken)&&same(registeredFactory,m.coreFactory));
  for(const c of m.collections){const actual=await rpc.getCode({address:c.address,blockNumber:height});requireReclaimEvidence(actual&&same(keccak256(actual),c.runtimeHash));}
}

export async function verifyReclaimFixtureBirth(rpc:PublicClient,m:ReclaimFixtureModule,campaign:Address,at:BlockEvidence,observed?:FixtureTreasuryProofLog):Promise<ReclaimFixtureBirth>{
  const end=BigInt(at.blockNumber),start=BigInt(m.deployment.blockNumber);requireReclaimEvidence(end>=start&&end-start<=4096n&&addr(campaign));
  requireReclaimEvidence(await rpc.getChainId()===31337);
  const logs=observed?[observed]:await rpc.getLogs({address:m.reclaimFactory,event:birthEvent,args:{campaign},fromBlock:start,toBlock:end});
  requireReclaimEvidence(logs.length===1);const log=logs[0]!;
  requireReclaimEvidence(log.transactionHash&&log.blockNumber!==null&&log.blockHash&&log.logIndex!==null&&same(log.address,m.reclaimFactory));
  const parsed=parseEventLogs({abi:factoryAbi,logs:[log as never],strict:true});requireReclaimEvidence(parsed.length===1&&parsed[0]!.eventName==="CampaignCreated");
  const args=parsed[0]!.args as unknown as{creator:Address;campaign:Address;intent:Hash;controller:Address;rewardPerUnit:bigint;walletCap:number};
  requireReclaimEvidence(same(args.campaign,campaign)&&addr(args.creator)&&addr(args.controller)&&hash(args.intent)&&args.rewardPerUnit>0n&&args.walletCap>0);
  const[receipt,header,code,creator,controller,factory,token,tokenHash,chain,rate,cap,mapped,predicted]=await Promise.all([
    rpc.getTransactionReceipt({hash:log.transactionHash}),rpc.getBlock({blockNumber:log.blockNumber}),rpc.getCode({address:campaign,blockNumber:log.blockNumber}),
    read<Address>(rpc,campaign,false,"creator",[],log.blockNumber),read<Address>(rpc,campaign,false,"controller",[],log.blockNumber),
    read<Address>(rpc,campaign,false,"deploymentFactory",[],log.blockNumber),read<Address>(rpc,campaign,false,"rewardToken",[],log.blockNumber),
    read<Hash>(rpc,campaign,false,"rewardRuntimeHash",[],log.blockNumber),read<bigint>(rpc,campaign,false,"deploymentChainId",[],log.blockNumber),
    read<bigint>(rpc,campaign,false,"rewardPerUnit",[],log.blockNumber),read<number>(rpc,campaign,false,"walletCap",[],log.blockNumber),
    read<Address>(rpc,m.reclaimFactory,true,"campaignForIntent",[args.creator,args.intent],log.blockNumber),
    read<Address>(rpc,m.reclaimFactory,true,"predict",[args.creator,args.intent,args.controller,args.rewardPerUnit,args.walletCap],log.blockNumber),
  ]);
  const birthPoint={blockNumber:log.blockNumber.toString(),blockHash:log.blockHash,timestamp:new Date(Number(header.timestamp)*1000).toISOString()};
  assertCanonicalReceiptLog(receipt,header,birthPoint,log);
  const expected=materializeReclaimRuntime(m.campaignRuntimeTemplate,m.campaignImmutableReferences,m.campaignImmutableNames,
    {creator:args.creator,rewardToken:m.rewardToken,rewardRuntimeHash:m.rewardTokenRuntimeHash,deploymentChainId:31337,deploymentFactory:m.reclaimFactory});
  requireReclaimEvidence(code&&same(code,expected)&&same(creator,args.creator)&&same(controller,args.controller)&&same(factory,m.reclaimFactory)
    &&same(token,m.rewardToken)&&same(tokenHash,m.rewardTokenRuntimeHash)&&chain===31337n&&rate===args.rewardPerUnit&&cap===args.walletCap&&same(mapped,campaign)&&same(predicted,campaign));
  return{campaign,creator:args.creator,controller:args.controller,intentId:args.intent,rewardToken:m.rewardToken,rewardTokenRuntimeHash:m.rewardTokenRuntimeHash,
    runtimeHash:keccak256(code),initialRewardPerUnit:args.rewardPerUnit.toString(),walletCap:args.walletCap,
    deployment:{...birthPoint,transactionHash:log.transactionHash,logIndex:log.logIndex}};
}

export async function readReclaimFixtureSnapshot(rpc:PublicClient,m:ReclaimFixtureModule,birth:ReclaimFixtureBirth,at:BlockEvidence):Promise<ReclaimFixtureSnapshot>{
  const height=BigInt(at.blockNumber),campaign=birth.campaign;
  const[code,factoryCode,tokenCode]=await Promise.all([rpc.getCode({address:campaign,blockNumber:height}),rpc.getCode({address:m.reclaimFactory,blockNumber:height}),rpc.getCode({address:m.rewardToken,blockNumber:height})]);
  requireReclaimEvidence(code&&same(keccak256(code),birth.runtimeHash)&&factoryCode&&same(keccak256(factoryCode),m.factoryRuntimeHash)&&tokenCode&&same(keccak256(tokenCode),m.rewardTokenRuntimeHash));
  const names=["controller","controllerEpoch","policyEpoch","rewardPerUnit","walletCap","paused","closed","reserve","funded","paid","repaid","recovered","unsolicited","outstandingLiability","tradeInNonce"];
  const values=await Promise.all(names.map(name=>read<unknown>(rpc,campaign,false,name,[],height)));
  const v=Object.fromEntries(names.map((name,index)=>[name,values[index]]));
  const balance=await rpc.readContract({address:m.rewardToken,abi:erc20Abi,functionName:"balanceOf",args:[campaign],blockNumber:height});
  requireReclaimEvidence(addr(v.controller)&&typeof v.paused==="boolean"&&typeof v.closed==="boolean"&&typeof v.walletCap==="number"
    &&v.walletCap>0&&typeof v.controllerEpoch==="bigint"&&v.controllerEpoch>0n&&typeof v.policyEpoch==="bigint"&&v.policyEpoch>0n);
  for(const name of["reserve","funded","paid","repaid","recovered","unsolicited","outstandingLiability","rewardPerUnit","tradeInNonce"])requireReclaimEvidence(typeof v[name]==="bigint"&&(v[name]as bigint)>=0n);
  const n=v as Record<string,bigint>;requireReclaimEvidence(n.outstandingLiability===0n&&balance>=n.reserve!&&n.rewardPerUnit!>0n
    &&(!v.closed||v.paused)&&n.funded!+n.repaid!+n.unsolicited! === n.reserve!+n.paid!+n.recovered!);
  const collections:ReclaimFixtureSnapshot["collections"]=[];
  for(const c of m.collections){
    const p=await read<readonly[Hash,Hash,number,number,0|1|2,boolean]>(rpc,campaign,false,"collections",[c.address],height);
    if(p[5]){const actual=await rpc.getCode({address:c.address,blockNumber:height});
      const eligible=buildReclaimEligibility({chainId:31337,campaign,collection:c.address,runtimeHash:c.runtimeHash,standard:c.standard,items:c.items},{keccak256,encodeAbiParameters:importEncoder});
      requireReclaimEvidence(same(p[0],c.runtimeHash)&&same(p[1],eligible.root)&&p[4]===c.standard&&actual&&same(keccak256(actual),c.runtimeHash));}
    collections.push({collection:c.address,runtimeHash:p[0],eligibilityRoot:p[1],collectionCap:p[2],walletCap:p[3],standard:p[4],enabled:p[5]});
  }
  return{...at,campaign,controller:v.controller,controllerEpoch:n.controllerEpoch!.toString(),policyEpoch:n.policyEpoch!.toString(),rewardPerUnit:n.rewardPerUnit!.toString(),walletCap:v.walletCap,
    paused:v.paused,closed:v.closed,reserve:n.reserve!.toString(),funded:n.funded!.toString(),paid:n.paid!.toString(),repaid:n.repaid!.toString(),recovered:n.recovered!.toString(),unsolicited:n.unsolicited!.toString(),
    outstandingLiability:"0",rewardBalance:balance.toString(),tradeInNonce:n.tradeInNonce!.toString(),collections};
}

type CanonicalReceipt=Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>;
async function exactRewardTransfer(rpc:PublicClient,m:ReclaimFixtureModule,receipt:CanonicalReceipt,header:Awaited<ReturnType<PublicClient["getBlock"]>>,from:Address,to:Address,amount:bigint){
  requireReclaimEvidence(amount>0n&&header.transactions.length===1&&receipt.transactionIndex===0&&receipt.blockNumber>0n&&!same(from,to));
  const transfers=parseEventLogs({abi:erc20Abi,eventName:"Transfer",strict:true,logs:receipt.logs.filter(l=>same(l.address,m.rewardToken))});
  requireReclaimEvidence(transfers.length===1&&same(transfers[0]!.args.from,from)&&same(transfers[0]!.args.to,to)&&transfers[0]!.args.value===amount);
  const[fromBefore,fromAfter,toBefore,toAfter]=await Promise.all([rpc.readContract({address:m.rewardToken,abi:erc20Abi,functionName:"balanceOf",args:[from],blockNumber:receipt.blockNumber-1n}),
    rpc.readContract({address:m.rewardToken,abi:erc20Abi,functionName:"balanceOf",args:[from],blockNumber:receipt.blockNumber}),
    rpc.readContract({address:m.rewardToken,abi:erc20Abi,functionName:"balanceOf",args:[to],blockNumber:receipt.blockNumber-1n}),
    rpc.readContract({address:m.rewardToken,abi:erc20Abi,functionName:"balanceOf",args:[to],blockNumber:receipt.blockNumber})]);
  requireReclaimEvidence(fromAfter+amount===fromBefore&&toAfter===toBefore+amount);
}
async function proveTradeIn(rpc:PublicClient,m:ReclaimFixtureModule,campaign:Address,receipt:CanonicalReceipt,header:Awaited<ReturnType<PublicClient["getBlock"]>>,name:string,args:Record<string,unknown>):Promise<ReclaimFixtureEvent["settlement"]>{
  requireReclaimEvidence(typeof args.receiptId==="bigint"&&addr(args.claimant));const id=args.receiptId,claimant=args.claimant;
  const[trade,items,collectionHash]=await Promise.all([
    read<readonly[Address,Address,number,bigint,bigint,number,number]>(rpc,campaign,false,"tradeIns",[id],receipt.blockNumber),
    read<readonly[readonly bigint[],readonly bigint[]]>(rpc,campaign,false,"receiptItems",[id],receipt.blockNumber),
    read<Hash>(rpc,campaign,false,"receiptCollectionHash",[id],receipt.blockNumber)]);
  const returned=name==="TradeInReturned",collection=trade[1],standard=trade[2];
  requireReclaimEvidence(same(trade[0],claimant)&&addr(collection)&&[1,2].includes(standard)&&trade[4]>0n&&trade[6]===(returned?2:1));
  const manifest=m.collections.find(c=>same(c.address,collection));requireReclaimEvidence(manifest&&manifest.standard===standard&&same(manifest.runtimeHash,collectionHash));
  const actual=await rpc.getCode({address:collection,blockNumber:receipt.blockNumber});requireReclaimEvidence(actual&&same(keccak256(actual),collectionHash));
  const[ids,quantities]=items;requireReclaimEvidence(ids.length>0&&ids.length<=8&&ids.length===quantities.length);
  let units=0n;for(let i=0;i<ids.length;i++){requireReclaimEvidence(ids[i]!>=0n&&(i===0||ids[i]!>ids[i-1]!)&&quantities[i]!>0n&&quantities[i]!<=20n&&(standard!==1||quantities[i]===1n));units+=quantities[i]!;}
  requireReclaimEvidence(units<=20n&&BigInt(trade[5])===units);
  if(returned)requireReclaimEvidence(args.rewardRepaid===trade[4]);
  else requireReclaimEvidence(same(String(args.collection),collection)&&args.standard===standard&&args.reward===trade[4]&&args.policyEpoch===trade[3]
    &&stringify(args.ids)===stringify(ids)&&stringify(args.quantities)===stringify(quantities));
  const nftFrom=returned?campaign:claimant,nftTo=returned?claimant:campaign;
  const nftLogs=parseEventLogs({abi:nftAbi,strict:true,logs:receipt.logs.filter(l=>same(l.address,collection))})as unknown as{eventName:string;args:Record<string,unknown>}[];
  const transfers=nftLogs.filter(l=>["Transfer","TransferSingle","TransferBatch"].includes(l.eventName));
  if(standard===1){requireReclaimEvidence(transfers.length===ids.length);for(const tokenId of ids){const found=transfers.filter(l=>l.eventName==="Transfer"&&l.args.tokenId===tokenId&&same(String(l.args.from),nftFrom)&&same(String(l.args.to),nftTo));requireReclaimEvidence(found.length===1);
    const[before,after]=await Promise.all([rpc.readContract({address:collection,abi:nftAbi,functionName:"ownerOf",args:[tokenId],blockNumber:receipt.blockNumber-1n}),rpc.readContract({address:collection,abi:nftAbi,functionName:"ownerOf",args:[tokenId],blockNumber:receipt.blockNumber})]);requireReclaimEvidence(same(before,nftFrom)&&same(after,nftTo));}}
  else{requireReclaimEvidence(transfers.length===1&&transfers[0]!.eventName==="TransferBatch");const log=transfers[0]!.args;
    requireReclaimEvidence(same(String(log.operator),campaign)&&same(String(log.from),nftFrom)&&same(String(log.to),nftTo)&&stringify(log.ids)===stringify(ids)&&stringify(log.values)===stringify(quantities));
    for(let i=0;i<ids.length;i++){const tokenId=ids[i]!,amount=quantities[i]!;const[beforeFrom,afterFrom,beforeTo,afterTo]=await Promise.all([
      rpc.readContract({address:collection,abi:nftAbi,functionName:"balanceOf",args:[nftFrom,tokenId],blockNumber:receipt.blockNumber-1n}),rpc.readContract({address:collection,abi:nftAbi,functionName:"balanceOf",args:[nftFrom,tokenId],blockNumber:receipt.blockNumber}),
      rpc.readContract({address:collection,abi:nftAbi,functionName:"balanceOf",args:[nftTo,tokenId],blockNumber:receipt.blockNumber-1n}),rpc.readContract({address:collection,abi:nftAbi,functionName:"balanceOf",args:[nftTo,tokenId],blockNumber:receipt.blockNumber})]);requireReclaimEvidence(afterFrom+amount===beforeFrom&&afterTo===beforeTo+amount);}}
  const from=returned?claimant:campaign,to=returned?campaign:claimant;await exactRewardTransfer(rpc,m,receipt,header,from,to,trade[4]);
  return{kind:returned?"return":"trade-in",rewardToken:m.rewardToken,from,to,amount:trade[4].toString(),receiptId:id.toString(),claimant,collection,standard:standard as 1|2,
    tokenIds:ids.map(String),quantities:quantities.map(String),evidence:"exact-receipt-transfer-and-single-transaction-block-deltas"};
}

export async function readReclaimFixtureRange(db:Pick<Client,"query">,scope:ReclaimFixtureScope,m:ReclaimFixtureModule,rpc:PublicClient,blocks:BlockEvidence[]):Promise<ReclaimFixtureRange>{
  requireReclaimEvidence(blocks.length>0&&blocks.length<=32);const from=BigInt(blocks[0]!.blockNumber),to=BigInt(blocks.at(-1)!.blockNumber);
  if(to>=BigInt(m.deployment.blockNumber)){
    await verifyReclaimFixtureModule(rpc,m);
    const[factoryCode,tokenCode]=await Promise.all([rpc.getCode({address:m.reclaimFactory,blockNumber:to}),rpc.getCode({address:m.rewardToken,blockNumber:to})]);
    requireReclaimEvidence(factoryCode&&same(keccak256(factoryCode),m.factoryRuntimeHash)&&tokenCode&&same(keccak256(tokenCode),m.rewardTokenRuntimeHash));
  }
  const existing=await storedReclaimFixtureBirths(db,scope,m);
  const birthLogs=await rpc.getLogs({address:m.reclaimFactory,event:birthEvent,fromBlock:from,toBlock:to});requireReclaimEvidence(birthLogs.length<=64);
  const births:ReclaimFixtureBirth[]=[];
  for(const log of birthLogs){const decoded=decodeEventLog({abi:factoryAbi,data:log.data,topics:log.topics})as unknown as{eventName:string;args:{campaign:Address}};
    requireReclaimEvidence(decoded.eventName==="CampaignCreated");births.push(await verifyReclaimFixtureBirth(rpc,m,decoded.args.campaign,blocks.at(-1)!,log));}
  const all=new Map<string,ReclaimFixtureBirth>();for(const birth of[...existing,...births]){const old=all.get(birth.campaign.toLowerCase());requireReclaimEvidence(!old||stringify(old)===stringify(birth));all.set(birth.campaign.toLowerCase(),birth);}requireReclaimEvidence(all.size<=64);
  const logs=all.size?await rpc.getLogs({address:[...all.values()].map(b=>b.campaign),fromBlock:from,toBlock:to}):[];requireReclaimEvidence(logs.length<=512);
  const events:ReclaimFixtureEvent[]=[],receipts=new Map<string,ReturnType<PublicClient["getTransactionReceipt"]>>(),headers=new Map<string,ReturnType<PublicClient["getBlock"]>>(),seenEvents=new Set<string>();
  for(const log of logs){requireReclaimEvidence(log.transactionHash&&log.blockNumber!==null&&log.blockHash&&log.logIndex!==null&&!log.removed);
    const at=blocks.find(b=>b.blockNumber===log.blockNumber!.toString()&&same(b.blockHash,log.blockHash!));requireReclaimEvidence(at);
    const txKey=log.transactionHash.toLowerCase(),height=log.blockNumber.toString();if(!receipts.has(txKey))receipts.set(txKey,rpc.getTransactionReceipt({hash:log.transactionHash}));if(!headers.has(height))headers.set(height,rpc.getBlock({blockNumber:log.blockNumber}));
    const[receipt,header]=await Promise.all([receipts.get(txKey)!,headers.get(height)!]);assertCanonicalReceiptLog(receipt,header,at,log);
    const identity=`${txKey}:${log.logIndex}`;if(seenEvents.has(identity))continue;seenEvents.add(identity);
    const parsed=parseEventLogs({abi:campaignAbi,logs:[log],strict:true})as unknown as{eventName:string;args:Record<string,unknown>}[];requireReclaimEvidence(parsed.length===1);
    const{name,args}= {name:parsed[0]!.eventName,args:parsed[0]!.args};let settlement:ReclaimFixtureEvent["settlement"];
    if(name==="TradeInAccepted"||name==="TradeInReturned")settlement=await proveTradeIn(rpc,m,log.address,receipt,header,name,args);
    else if(name==="Funded"||name==="ReserveRecovered"){
      requireReclaimEvidence(addr(args.controller)&&typeof args.amount==="bigint");const fund=name==="Funded",fromAddress=fund?args.controller:log.address,toAddress=fund?log.address:args.controller;
      await exactRewardTransfer(rpc,m,receipt,header,fromAddress,toAddress,args.amount);settlement={kind:fund?"fund":"recover",rewardToken:m.rewardToken,from:fromAddress,to:toAddress,amount:args.amount.toString(),evidence:"exact-receipt-transfer-and-single-transaction-block-deltas"};
    }
    events.push({...at,campaign:log.address,transactionHash:log.transactionHash,logIndex:log.logIndex,event:name,args:JSON.parse(stringify(args))as Record<string,unknown>,...(settlement&&{settlement})});
  }
  const states=[];for(const birth of all.values())states.push(await readReclaimFixtureSnapshot(rpc,m,birth,blocks.at(-1)!));
  return{births,events,states};
}
