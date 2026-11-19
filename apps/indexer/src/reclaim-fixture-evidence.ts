import {readFileSync,statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {BaseError,ContractFunctionRevertedError,decodeEventLog,decodeFunctionData,encodeFunctionData,erc20Abi,keccak256,parseAbi,parseAbiItem,parseEventLogs,zeroAddress,type Address,type Hash,type PublicClient} from "viem";
import {materializeReclaimRuntime,reclaimFactorySignatures,reclaimCampaignSignatures,buildReclaimEligibility} from "../../../packages/launchpad-common/reclaim-v2-runtime.mjs";
import {assertFixtureTreasuryReceiptLog as assertCanonicalReceiptLog,type FixtureTreasuryProofLog} from "./project-treasury-fixture-store.js";
import type {BlockEvidence,CurveFixtureBinding} from "./curve-launch-evidence.js";
import {storedReclaimFixtureBirths} from "./reclaim-fixture-store.js";
import {reclaimFixtureProfile,type ReclaimFixtureModule,type ReclaimFixtureBirth,type ReclaimFixtureEvent,type ReclaimFixtureSnapshot,
  type ReclaimFixtureScope,type ReclaimFixtureRange} from "./reclaim-fixture-types.js";
import type{Client}from"pg";
import{verifyReclaimExactOrigin,verifyReclaimOrigin}from"./reclaim-fixture-origin.js";

const factoryAbi=parseAbi(reclaimFactorySignatures),campaignAbi=parseAbi(reclaimCampaignSignatures);
const birthEvent=parseAbiItem("event CampaignCreated(address indexed creator,address indexed campaign,bytes32 indexed intent,address controller,uint128 rewardPerUnit,uint32 walletCap)");
const nftAbi=parseAbi(["function ownerOf(uint256) view returns(address)","function balanceOf(address,uint256) view returns(uint256)",
  "function balanceOf(address) view returns(uint256)","function totalSupply() view returns(uint256)","function totalSupply(uint256) view returns(uint256)","function exists(uint256) view returns(bool)",
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
  if(env.RMT_RECLAIM_FIXTURE!=="local-reviewed-reclaim-v2-permanent"||env.NETLIFY||env.RAILWAY_ENVIRONMENT_ID||env.VERCEL||env.DEPLOY_ID||env.CONTEXT)throw Error("Permanent fixture reclaim profile is disabled or hosted");
  const file=env.RMT_RECLAIM_DEPLOYMENT;requireReclaimEvidence(file&&isAbsolute(file)&&statSync(file).size<=180_000);
  const m=JSON.parse(readFileSync(file!,"utf8"))as ReclaimFixtureModule;
  requireReclaimEvidence(m.schemaVersion===2&&m.profile===reclaimFixtureProfile&&m.chainId===31337
    &&[m.reclaimFactory,m.coreFactory,m.rewardToken,m.campaignDeployer,m.permanentSink,m.creationPart1,m.creationPart2].every(addr)
    &&[m.factoryRuntimeHash,m.coreFactoryRuntimeHash,m.rewardTokenRuntimeHash,m.campaignCreationCodeHash,m.deployerRuntimeHash,m.sinkRuntimeHash,m.retirementProfilesHash,m.creationPart1RuntimeHash,m.creationPart2RuntimeHash,m.deployment.transactionHash,m.deployment.blockHash].every(hash)
    &&same(m.coreFactory,binding.factory)&&same(m.coreFactoryRuntimeHash,binding.factoryRuntimeHash)
    &&/^[1-9][0-9]{0,15}$/.test(m.deployment.blockNumber)&&BigInt(m.deployment.blockNumber)>=binding.deploymentBlock
    &&/^[0-9a-f]{64}$/.test(m.compilerInputSha256)&&/^0x(?:[0-9a-f]{2}){1,49152}$/i.test(m.campaignCreationCode)
    &&same(keccak256(m.campaignCreationCode),m.campaignCreationCodeHash)
    &&Array.isArray(m.collections)&&m.collections.length>0&&m.collections.length<=16
    &&Array.isArray(m.retirementProfiles)&&m.retirementProfiles.length>0&&m.retirementProfiles.length<=16
    &&new Set(m.collections.map(c=>c.address.toLowerCase())).size===m.collections.length);
  for(const p of m.retirementProfiles)requireReclaimEvidence(hash(p.runtimeHash)&&hash(p.policyHash)&&[1,2].includes(p.standard)&&[1,2].includes(p.mode));
  requireReclaimEvidence(same(retirementProfilesHash(m),m.retirementProfilesHash));
  requireReclaimEvidence(new Set(m.retirementProfiles.map(p=>`${p.runtimeHash.toLowerCase()}:${p.standard}:${p.mode}`)).size===m.retirementProfiles.length);
  for(const c of m.collections){requireReclaimEvidence(addr(c.address)&&hash(c.runtimeHash)&&[1,2].includes(c.standard)&&[1,2].includes(c.retirementMode)&&hash(c.policyHash)
      &&m.retirementProfiles.some(p=>same(p.runtimeHash,c.runtimeHash)&&p.standard===c.standard&&p.mode===c.retirementMode&&same(p.policyHash,c.policyHash)));
    // Shape/uniqueness only; this does not admit a real collection or market.
    buildReclaimEligibility({chainId:31337,campaign:m.reclaimFactory,collection:c.address,runtimeHash:c.runtimeHash,standard:c.standard,retirementMode:c.retirementMode,policyHash:c.policyHash,items:c.items},
      {keccak256,encodeAbiParameters:(types,values)=>importEncoder(types,values)});
  }
  materializeReclaimRuntime(m.campaignRuntimeTemplate,m.campaignImmutableReferences,m.campaignImmutableNames,
    {creator:m.coreFactory,rewardToken:m.rewardToken,rewardRuntimeHash:m.rewardTokenRuntimeHash,deploymentChainId:31337,deploymentFactory:m.reclaimFactory,permanentSink:m.permanentSink,sinkRuntimeHash:m.sinkRuntimeHash});
  return m;
}
// Kept outside the pure shared helper; this is the existing pinned viem codec.
import {encodeAbiParameters} from "viem";
function importEncoder(types:readonly{type:string}[],values:readonly unknown[]){return encodeAbiParameters(types as never,values as never);}
function retirementProfilesHash(m:ReclaimFixtureModule){return keccak256(encodeAbiParameters([{type:"tuple[]",components:[{name:"runtimeHash",type:"bytes32"},{name:"standard",type:"uint8"},{name:"mode",type:"uint8"},{name:"policyHash",type:"bytes32"}]}],[m.retirementProfiles]));}

export async function verifyReclaimFixtureModule(rpc:PublicClient,m:ReclaimFixtureModule){
  const height=BigInt(m.deployment.blockNumber);
  requireReclaimEvidence(same(retirementProfilesHash(m),m.retirementProfilesHash));
  const deployerAbi=parseAbi(["function creationPart1() view returns(address)","function creationPart2() view returns(address)","function campaignCreationCodeHash() view returns(bytes32)",
    "function factory() view returns(address)","function rewardToken() view returns(address)","function rewardRuntimeHash() view returns(bytes32)","function permanentSink() view returns(address)","function deploymentChainId() view returns(uint256)","function creationPart1Hash() view returns(bytes32)","function creationPart2Hash() view returns(bytes32)"]);
  const[part1,part2,part1Address,part2Address,deployerCreationHash]=await Promise.all([
    rpc.getCode({address:m.creationPart1,blockNumber:height}),rpc.getCode({address:m.creationPart2,blockNumber:height}),
    rpc.readContract({address:m.campaignDeployer,abi:deployerAbi,functionName:"creationPart1",blockNumber:height}),rpc.readContract({address:m.campaignDeployer,abi:deployerAbi,functionName:"creationPart2",blockNumber:height}),
    rpc.readContract({address:m.campaignDeployer,abi:deployerAbi,functionName:"campaignCreationCodeHash",blockNumber:height})]);
  requireReclaimEvidence(part1&&part2&&/^0x00(?:[0-9a-f]{2}){1,24575}$/i.test(part1)&&/^0x00(?:[0-9a-f]{2}){1,24575}$/i.test(part2)
    &&same(keccak256(part1),m.creationPart1RuntimeHash)&&same(keccak256(part2),m.creationPart2RuntimeHash)
    &&same("0x"+part1.slice(4)+part2.slice(4),m.campaignCreationCode)&&same(part1Address,m.creationPart1)&&same(part2Address,m.creationPart2)&&same(deployerCreationHash,m.campaignCreationCodeHash));
  const configured=await Promise.all(["factory","rewardToken","rewardRuntimeHash","permanentSink","deploymentChainId","creationPart1Hash","creationPart2Hash"].map(functionName=>rpc.readContract({address:m.campaignDeployer,abi:deployerAbi,functionName,blockNumber:height} as never)));
  requireReclaimEvidence(configured[4]===31337n&&same(String(configured[0]),m.reclaimFactory)&&same(String(configured[1]),m.rewardToken)&&same(String(configured[2]),m.rewardTokenRuntimeHash)
    &&same(String(configured[3]),m.permanentSink)&&same(String(configured[5]),m.creationPart1RuntimeHash)&&same(String(configured[6]),m.creationPart2RuntimeHash));
  const[deployerCode,sinkCode,deployer,sink,sinkHash,profilesHash]=await Promise.all([
    rpc.getCode({address:m.campaignDeployer,blockNumber:height}),rpc.getCode({address:m.permanentSink,blockNumber:height}),
    read<Address>(rpc,m.reclaimFactory,true,"campaignDeployer",[],height),read<Address>(rpc,m.reclaimFactory,true,"permanentSink",[],height),
    read<Hash>(rpc,m.reclaimFactory,true,"sinkRuntimeHash",[],height),read<Hash>(rpc,m.reclaimFactory,true,"retirementProfilesHash",[],height)]);
  requireReclaimEvidence(deployerCode&&same(keccak256(deployerCode),m.deployerRuntimeHash)&&sinkCode&&same(keccak256(sinkCode),m.sinkRuntimeHash)
    &&same(deployer,m.campaignDeployer)&&same(sink,m.permanentSink)&&same(sinkHash,m.sinkRuntimeHash)&&same(profilesHash,m.retirementProfilesHash));
  for(const p of m.retirementProfiles)requireReclaimEvidence(same(await read<Hash>(rpc,m.reclaimFactory,true,"retirementPolicy",[p.runtimeHash,p.standard,p.mode],height),p.policyHash));
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
  // The reviewed fixture deploys candidate assets before the module factory.
  // Require those exact runtime identities at birth as well as admission and
  // settlement; a manifest with a later asset birth is not this fixture.
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
  await verifyReclaimExactOrigin(rpc,receipt,header,m.reclaimFactory,args.creator,
    encodeFunctionData({abi:factoryAbi,functionName:"create",args:[args.intent,args.controller,args.rewardPerUnit,args.walletCap]}));
  const expected=materializeReclaimRuntime(m.campaignRuntimeTemplate,m.campaignImmutableReferences,m.campaignImmutableNames,
    {creator:args.creator,rewardToken:m.rewardToken,rewardRuntimeHash:m.rewardTokenRuntimeHash,deploymentChainId:31337,deploymentFactory:m.reclaimFactory,permanentSink:m.permanentSink,sinkRuntimeHash:m.sinkRuntimeHash});
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
  const names=["controller","controllerEpoch","policyEpoch","rewardPerUnit","walletCap","paused","closed","reserve","funded","paid","recovered","unsolicited","outstandingLiability","tradeInNonce"];
  const values=await Promise.all(names.map(name=>read<unknown>(rpc,campaign,false,name,[],height)));
  const v=Object.fromEntries(names.map((name,index)=>[name,values[index]]));
  const balance=await rpc.readContract({address:m.rewardToken,abi:erc20Abi,functionName:"balanceOf",args:[campaign],blockNumber:height});
  requireReclaimEvidence(addr(v.controller)&&typeof v.paused==="boolean"&&typeof v.closed==="boolean"&&typeof v.walletCap==="number"
    &&v.walletCap>0&&typeof v.controllerEpoch==="bigint"&&v.controllerEpoch>0n&&typeof v.policyEpoch==="bigint"&&v.policyEpoch>0n);
  for(const name of["reserve","funded","paid","recovered","unsolicited","outstandingLiability","rewardPerUnit","tradeInNonce"])requireReclaimEvidence(typeof v[name]==="bigint"&&(v[name]as bigint)>=0n);
  const n=v as Record<string,bigint>;requireReclaimEvidence(n.outstandingLiability===0n&&balance>=n.reserve!&&n.rewardPerUnit!>0n
    &&(!v.closed||v.paused)&&n.funded!+n.unsolicited! === n.reserve!+n.paid!+n.recovered!);
  const collections:ReclaimFixtureSnapshot["collections"]=[];
  for(const c of m.collections){
    const p=await read<readonly[Hash,Hash,number,number,0|1|2,0|1|2,Hash,boolean]>(rpc,campaign,false,"collections",[c.address],height);
    if(p[7]){const actual=await rpc.getCode({address:c.address,blockNumber:height});
      const eligible=buildReclaimEligibility({chainId:31337,campaign,collection:c.address,runtimeHash:c.runtimeHash,standard:c.standard,retirementMode:c.retirementMode,policyHash:c.policyHash,items:c.items},{keccak256,encodeAbiParameters:importEncoder});
      requireReclaimEvidence(same(p[0],c.runtimeHash)&&same(p[1],eligible.root)&&p[4]===c.standard&&p[5]===c.retirementMode&&same(p[6],c.policyHash)&&actual&&same(keccak256(actual),c.runtimeHash));}
    collections.push({collection:c.address,runtimeHash:p[0],eligibilityRoot:p[1],collectionCap:p[2],walletCap:p[3],standard:p[4],retirementMode:p[5],policyHash:p[6],enabled:p[7]});
  }
  return{...at,campaign,controller:v.controller,controllerEpoch:n.controllerEpoch!.toString(),policyEpoch:n.policyEpoch!.toString(),rewardPerUnit:n.rewardPerUnit!.toString(),walletCap:v.walletCap,
    paused:v.paused,closed:v.closed,reserve:n.reserve!.toString(),funded:n.funded!.toString(),paid:n.paid!.toString(),recovered:n.recovered!.toString(),unsolicited:n.unsolicited!.toString(),
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
export async function proveReclaimPermanentSurrender(rpc:PublicClient,m:ReclaimFixtureModule,campaign:Address,receipt:CanonicalReceipt,header:Awaited<ReturnType<PublicClient["getBlock"]>>,args:Record<string,unknown>):Promise<ReclaimFixtureEvent["settlement"]>{
  requireReclaimEvidence(typeof args.receiptId==="bigint"&&addr(args.claimant));const id=args.receiptId,claimant=args.claimant;
  const[trade,items,collectionHash]=await Promise.all([
    read<readonly[Address,Address,number,bigint,bigint,number,number,number,Address]>(rpc,campaign,false,"tradeIns",[id],receipt.blockNumber),
    read<readonly[readonly bigint[],readonly bigint[]]>(rpc,campaign,false,"receiptItems",[id],receipt.blockNumber),
    read<Hash>(rpc,campaign,false,"receiptCollectionHash",[id],receipt.blockNumber)]);
  const collection=trade[1],standard=trade[2],mode=trade[7],destination=trade[8];
  requireReclaimEvidence(same(trade[0],claimant)&&addr(collection)&&[1,2].includes(standard)&&[1,2].includes(mode)&&trade[4]>0n&&trade[6]===1
    &&same(destination,mode===1?zeroAddress:m.permanentSink));
  const manifest=m.collections.find(c=>same(c.address,collection));requireReclaimEvidence(manifest&&manifest.standard===standard&&manifest.retirementMode===mode&&same(manifest.runtimeHash,collectionHash));
  const actual=await rpc.getCode({address:collection,blockNumber:receipt.blockNumber});requireReclaimEvidence(actual&&same(keccak256(actual),collectionHash));
  requireReclaimEvidence(same(await read<Hash>(rpc,m.reclaimFactory,true,"retirementPolicy",[collectionHash,standard,mode],receipt.blockNumber),manifest.policyHash));
  if(mode===2){const sinkCode=await rpc.getCode({address:m.permanentSink,blockNumber:receipt.blockNumber});requireReclaimEvidence(sinkCode&&same(keccak256(sinkCode),m.sinkRuntimeHash));}
  const[ids,quantities]=items;requireReclaimEvidence(ids.length>0&&ids.length<=8&&ids.length===quantities.length);
  let units=0n;for(let i=0;i<ids.length;i++){requireReclaimEvidence(ids[i]!>=0n&&(i===0||ids[i]!>ids[i-1]!)&&quantities[i]!>0n&&quantities[i]!<=20n&&(standard!==1||quantities[i]===1n));units+=quantities[i]!;}
  requireReclaimEvidence(units<=20n&&BigInt(trade[5])===units);
  requireReclaimEvidence(same(String(args.collection),collection)&&args.standard===standard&&args.reward===trade[4]&&args.policyEpoch===trade[3]
    &&args.retirementMode===mode&&same(String(args.destination),destination)&&stringify(args.ids)===stringify(ids)&&stringify(args.quantities)===stringify(quantities));
  const permanent=parseEventLogs({abi:campaignAbi,eventName:"NFTPermanentlyRetired",strict:true,logs:receipt.logs.filter(l=>same(l.address,campaign))})as unknown as{args:Record<string,unknown>}[];
  requireReclaimEvidence(permanent.length===1);const retirement=permanent[0]!.args;
  requireReclaimEvidence(retirement.receiptId===id&&same(String(retirement.collection),collection)&&retirement.standard===standard&&retirement.retirementMode===mode
    &&same(String(retirement.destination),destination)&&stringify(retirement.ids)===stringify(ids)&&stringify(retirement.quantities)===stringify(quantities)
    &&Array.isArray(retirement.supplyBefore)&&Array.isArray(retirement.supplyAfter)&&retirement.supplyBefore.length===ids.length&&retirement.supplyAfter.length===ids.length);
  const nftFrom=claimant,nftTo=destination,supplyBefore:bigint[]=[],supplyAfter:bigint[]=[];
  const nftLogs=parseEventLogs({abi:nftAbi,strict:true,logs:receipt.logs.filter(l=>same(l.address,collection))})as unknown as{eventName:string;args:Record<string,unknown>}[];
  const transfers=nftLogs.filter(l=>["Transfer","TransferSingle","TransferBatch"].includes(l.eventName));
  if(standard===1){
    const[beforeSupply,afterSupply,beforeBalance,afterBalance]=await Promise.all([
      rpc.readContract({address:collection,abi:nftAbi,functionName:"totalSupply",args:[],blockNumber:receipt.blockNumber-1n}),rpc.readContract({address:collection,abi:nftAbi,functionName:"totalSupply",args:[],blockNumber:receipt.blockNumber}),
      rpc.readContract({address:collection,abi:nftAbi,functionName:"balanceOf",args:[claimant],blockNumber:receipt.blockNumber-1n}),rpc.readContract({address:collection,abi:nftAbi,functionName:"balanceOf",args:[claimant],blockNumber:receipt.blockNumber})]);
    requireReclaimEvidence(beforeBalance===afterBalance+units&&(mode===1?beforeSupply===afterSupply+units:beforeSupply===afterSupply));
    if(mode===2){const[oldHeld,newHeld]=await Promise.all([rpc.readContract({address:collection,abi:nftAbi,functionName:"balanceOf",args:[destination],blockNumber:receipt.blockNumber-1n}),rpc.readContract({address:collection,abi:nftAbi,functionName:"balanceOf",args:[destination],blockNumber:receipt.blockNumber})]);requireReclaimEvidence(newHeld===oldHeld+units);}
    requireReclaimEvidence(transfers.length===ids.length);
    for(let i=0;i<ids.length;i++){const tokenId=ids[i]!;const found=transfers.filter(l=>l.eventName==="Transfer"&&l.args.tokenId===tokenId&&same(String(l.args.from),nftFrom)&&same(String(l.args.to),nftTo));requireReclaimEvidence(found.length===1);
      requireReclaimEvidence(same(await rpc.readContract({address:collection,abi:nftAbi,functionName:"ownerOf",args:[tokenId],blockNumber:receipt.blockNumber-1n}),claimant));
      if(mode===1){
        requireReclaimEvidence(await rpc.readContract({address:collection,abi:nftAbi,functionName:"exists",args:[tokenId],blockNumber:receipt.blockNumber})===false);
        let absent=false;try{await rpc.readContract({address:collection,abi:nftAbi,functionName:"ownerOf",args:[tokenId],blockNumber:receipt.blockNumber});}catch(error){absent=error instanceof BaseError&&error.walk(e=>e instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError;}
        requireReclaimEvidence(absent);supplyBefore.push(beforeSupply-BigInt(i));supplyAfter.push(beforeSupply-BigInt(i)-1n);
      }else{requireReclaimEvidence(same(await rpc.readContract({address:collection,abi:nftAbi,functionName:"ownerOf",args:[tokenId],blockNumber:receipt.blockNumber}),destination));supplyBefore.push(beforeSupply);supplyAfter.push(afterSupply);}
    }
  }else{
    requireReclaimEvidence(transfers.length===ids.length||transfers.length===1);
    if(transfers.length===1&&transfers[0]!.eventName==="TransferBatch"){
      const log=transfers[0]!.args;requireReclaimEvidence(same(String(log.operator),campaign)&&same(String(log.from),nftFrom)&&same(String(log.to),nftTo)&&stringify(log.ids)===stringify(ids)&&stringify(log.values)===stringify(quantities));
    }else for(let i=0;i<ids.length;i++)requireReclaimEvidence(transfers.filter(l=>l.eventName==="TransferSingle"&&same(String(l.args.operator),campaign)&&same(String(l.args.from),claimant)&&same(String(l.args.to),destination)&&l.args.id===ids[i]&&l.args.value===quantities[i]).length===1);
    for(let i=0;i<ids.length;i++){const tokenId=ids[i]!,amount=quantities[i]!;const[beforeFrom,afterFrom,beforeSupply,afterSupply]=await Promise.all([
      rpc.readContract({address:collection,abi:nftAbi,functionName:"balanceOf",args:[claimant,tokenId],blockNumber:receipt.blockNumber-1n}),rpc.readContract({address:collection,abi:nftAbi,functionName:"balanceOf",args:[claimant,tokenId],blockNumber:receipt.blockNumber}),
      rpc.readContract({address:collection,abi:nftAbi,functionName:"totalSupply",args:[tokenId],blockNumber:receipt.blockNumber-1n}),rpc.readContract({address:collection,abi:nftAbi,functionName:"totalSupply",args:[tokenId],blockNumber:receipt.blockNumber})]);
      requireReclaimEvidence(afterFrom+amount===beforeFrom&&(mode===1?afterSupply+amount===beforeSupply:afterSupply===beforeSupply));
      if(mode===2){const[beforeTo,afterTo]=await Promise.all([rpc.readContract({address:collection,abi:nftAbi,functionName:"balanceOf",args:[destination,tokenId],blockNumber:receipt.blockNumber-1n}),rpc.readContract({address:collection,abi:nftAbi,functionName:"balanceOf",args:[destination,tokenId],blockNumber:receipt.blockNumber})]);requireReclaimEvidence(afterTo===beforeTo+amount);}
      supplyBefore.push(beforeSupply);supplyAfter.push(afterSupply);
    }
  }
  requireReclaimEvidence(stringify(retirement.supplyBefore)===stringify(supplyBefore)&&stringify(retirement.supplyAfter)===stringify(supplyAfter));
  await exactRewardTransfer(rpc,m,receipt,header,campaign,claimant,trade[4]);
  return{kind:"permanent-surrender",rewardToken:m.rewardToken,from:campaign,to:claimant,amount:trade[4].toString(),receiptId:id.toString(),claimant,collection,standard:standard as 1|2,
    retirementMode:mode as 1|2,disposition:mode===1?"native-burn":"permanent-sink",destination,policyHash:manifest.policyHash,
    tokenIds:ids.map(String),quantities:quantities.map(String),supplyBefore:supplyBefore.map(String),supplyAfter:supplyAfter.map(String),evidence:"exact-receipt-transfer-and-single-transaction-block-deltas"};
}

export async function readReclaimFixtureRange(db:Pick<Client,"query">,scope:ReclaimFixtureScope,m:ReclaimFixtureModule,rpc:PublicClient,blocks:BlockEvidence[]):Promise<ReclaimFixtureRange>{
  requireReclaimEvidence(blocks.length>0&&blocks.length<=32);const from=BigInt(blocks[0]!.blockNumber),to=BigInt(blocks.at(-1)!.blockNumber);
  if(to>=BigInt(m.deployment.blockNumber)){
    await verifyReclaimFixtureModule(rpc,m);
    for(const[address,expected]of[[m.reclaimFactory,m.factoryRuntimeHash],[m.rewardToken,m.rewardTokenRuntimeHash],[m.campaignDeployer,m.deployerRuntimeHash],[m.permanentSink,m.sinkRuntimeHash],[m.creationPart1,m.creationPart1RuntimeHash],[m.creationPart2,m.creationPart2RuntimeHash]] as const){
      const code=await rpc.getCode({address,blockNumber:to});requireReclaimEvidence(code&&same(keccak256(code),expected));
    }
  }
  const existing=await storedReclaimFixtureBirths(db,scope,m);
  const birthLogs=await rpc.getLogs({address:m.reclaimFactory,event:birthEvent,fromBlock:from,toBlock:to});requireReclaimEvidence(birthLogs.length<=64);
  const births:ReclaimFixtureBirth[]=[];
  for(const log of birthLogs){const decoded=decodeEventLog({abi:factoryAbi,data:log.data,topics:log.topics})as unknown as{eventName:string;args:{campaign:Address}};
    requireReclaimEvidence(decoded.eventName==="CampaignCreated");births.push(await verifyReclaimFixtureBirth(rpc,m,decoded.args.campaign,blocks.at(-1)!,log));}
  const all=new Map<string,ReclaimFixtureBirth>();for(const birth of[...existing,...births]){const old=all.get(birth.campaign.toLowerCase());requireReclaimEvidence(!old||stringify(old)===stringify(birth));all.set(birth.campaign.toLowerCase(),birth);}requireReclaimEvidence(all.size<=64);
  const logs=all.size?await rpc.getLogs({address:[...all.values()].map(b=>b.campaign),fromBlock:from,toBlock:to}):[];requireReclaimEvidence(logs.length<=512);
  // A matching log query is not proof that the query was complete. Read the
  // bounded canonical receipts for this already-scoped range and compare both
  // views before committing its checkpoint. No chain-wide history scan occurs.
  const expectedLogs:FixtureTreasuryProofLog[]=[],known=new Set([m.reclaimFactory,...[...all.values()].map(b=>b.campaign)].map(v=>v.toLowerCase()));
  for(const block of blocks){
    if(BigInt(block.blockNumber)<BigInt(m.deployment.blockNumber))continue;
    const header=await rpc.getBlock({blockNumber:BigInt(block.blockNumber)});
    requireReclaimEvidence(header.hash&&same(header.hash,block.blockHash)&&header.number===BigInt(block.blockNumber)&&header.transactions.length<=32
      &&new Date(Number(header.timestamp)*1000).toISOString()===block.timestamp);
    for(const transaction of header.transactions){
      requireReclaimEvidence(typeof transaction==="string");const receipt=await rpc.getTransactionReceipt({hash:transaction});
      requireReclaimEvidence(same(receipt.transactionHash,transaction)&&same(receipt.blockHash,block.blockHash)&&receipt.blockNumber===header.number
        &&receipt.transactionIndex>=0&&same(header.transactions[receipt.transactionIndex] as Hash,transaction));
      const scoped=receipt.logs.filter(l=>known.has(l.address.toLowerCase())&&(!same(l.address,m.reclaimFactory)
        ||parseEventLogs({abi:factoryAbi,eventName:"CampaignCreated",logs:[l],strict:true}).length===1));
      if(receipt.status!=="success"){requireReclaimEvidence(scoped.length===0);continue;}
      for(const l of scoped){assertCanonicalReceiptLog(receipt,header,block,l);expectedLogs.push(l);}
      if(receipt.to&&same(receipt.to,m.reclaimFactory)){
        const tx=await rpc.getTransaction({hash:receipt.transactionHash});requireReclaimEvidence(tx.to&&same(tx.to,m.reclaimFactory)&&same(tx.hash,receipt.transactionHash));
        const decoded=decodeFunctionData({abi:factoryAbi,data:tx.input});
        if(decoded.functionName==="create")requireReclaimEvidence(parseEventLogs({abi:factoryAbi,eventName:"CampaignCreated",logs:scoped,strict:true}).length===1);
      }
    }
  }
  const identity=(l:FixtureTreasuryProofLog)=>`${l.transactionHash?.toLowerCase()}:${l.logIndex}`;
  const observed=new Map<string,FixtureTreasuryProofLog>();
  for(const l of[...birthLogs,...logs]){const key=identity(l),old=observed.get(key);requireReclaimEvidence(!old||same(old.data,l.data)&&stringify(old.topics)===stringify(l.topics));observed.set(key,l);}
  requireReclaimEvidence(observed.size===expectedLogs.length);
  for(const expected of expectedLogs){const actual=observed.get(identity(expected));requireReclaimEvidence(actual&&same(actual.address,expected.address)&&same(actual.data,expected.data)
    &&stringify(actual.topics)===stringify(expected.topics)&&actual.blockNumber===expected.blockNumber&&same(actual.blockHash!,expected.blockHash!));}
  const events:ReclaimFixtureEvent[]=[],receipts=new Map<string,ReturnType<PublicClient["getTransactionReceipt"]>>(),headers=new Map<string,ReturnType<PublicClient["getBlock"]>>(),seenEvents=new Set<string>();
  for(const log of logs){requireReclaimEvidence(log.transactionHash&&log.blockNumber!==null&&log.blockHash&&log.logIndex!==null&&!log.removed);
    const at=blocks.find(b=>b.blockNumber===log.blockNumber!.toString()&&same(b.blockHash,log.blockHash!));requireReclaimEvidence(at);
    const txKey=log.transactionHash.toLowerCase(),height=log.blockNumber.toString();if(!receipts.has(txKey))receipts.set(txKey,rpc.getTransactionReceipt({hash:log.transactionHash}));if(!headers.has(height))headers.set(height,rpc.getBlock({blockNumber:log.blockNumber}));
    const[receipt,header]=await Promise.all([receipts.get(txKey)!,headers.get(height)!]);assertCanonicalReceiptLog(receipt,header,at,log);
    const identity=`${txKey}:${log.logIndex}`;if(seenEvents.has(identity))continue;seenEvents.add(identity);
    const parsed=parseEventLogs({abi:campaignAbi,logs:[log],strict:true})as unknown as{eventName:string;args:Record<string,unknown>}[];requireReclaimEvidence(parsed.length===1);
    const{name,args}= {name:parsed[0]!.eventName,args:parsed[0]!.args};let settlement:ReclaimFixtureEvent["settlement"];
    if(name==="TradeInAccepted")settlement=await proveReclaimPermanentSurrender(rpc,m,log.address,receipt,header,args);
    else if(name==="Funded"||name==="ReserveRecovered"){
      requireReclaimEvidence(addr(args.controller)&&typeof args.amount==="bigint");const fund=name==="Funded",fromAddress=fund?args.controller:log.address,toAddress=fund?log.address:args.controller;
      await exactRewardTransfer(rpc,m,receipt,header,fromAddress,toAddress,args.amount);settlement={kind:fund?"fund":"recover",rewardToken:m.rewardToken,from:fromAddress,to:toAddress,amount:args.amount.toString(),evidence:"exact-receipt-transfer-and-single-transaction-block-deltas"};
    }
    if(settlement)settlement.origin=await verifyReclaimOrigin(rpc,receipt,header,log.address,settlement.kind,args);
    events.push({...at,campaign:log.address,transactionHash:log.transactionHash,logIndex:log.logIndex,eventName:name,args:JSON.parse(stringify(args))as Record<string,unknown>,...(settlement&&{settlement})});
  }
  const states=[];for(const birth of all.values()){
    const state=await readReclaimFixtureSnapshot(rpc,m,birth,blocks.at(-1)!);
    const previousNonce=BigInt(birth.deployment.blockNumber)>=from?1n:await read<bigint>(rpc,birth.campaign,false,"tradeInNonce",[],from-1n);
    const accepted=events.filter(e=>same(e.campaign,birth.campaign)&&e.eventName==="TradeInAccepted").sort((a,b)=>BigInt(a.args.receiptId as string)<BigInt(b.args.receiptId as string)?-1:1);
    requireReclaimEvidence(BigInt(state.tradeInNonce)===previousNonce+BigInt(accepted.length));
    for(let i=0;i<accepted.length;i++)requireReclaimEvidence(BigInt(accepted[i]!.args.receiptId as string)===previousNonce+BigInt(i));
    states.push(state);
  }
  return{births,events,states};
}
