import {readFileSync,statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {encodeAbiParameters,encodeFunctionData,erc20Abi,getAddress,keccak256,parseAbi,parseEventLogs,zeroAddress,type Address,type Hex} from "viem";
import {reclaimFactorySignatures,reclaimCampaignSignatures,materializeReclaimRuntime,buildReclaimEligibility} from "../../../../packages/launchpad-common/reclaim-v2-runtime.mjs";
import {reclaimProfile,reclaimFixtureFlag,reclaimAddress,reclaimHash,reclaimUint,type ReclaimPoint,type ReclaimSnapshot,type ReclaimNotice} from "../reclaim";
import {configuredCurveFixture,fixtureRpc,verifyCurveFixture,type CurveFixture} from "./curve-fixture";
import {projectTreasuryControllerKind} from "./project-treasury-fixture";
import {readTreasuryBody} from "./project-treasury-actions";
import type {ReclaimAdministrationPolicy} from "../reclaim-administration";
import {configuredReclaimAdministration,reclaimAdministrationEvidence} from "./reclaim-administration";

export const reclaimFactoryAbi=parseAbi(reclaimFactorySignatures);
export const reclaimCampaignAbi=parseAbi(reclaimCampaignSignatures);
export const reclaim721Abi=parseAbi(["function ownerOf(uint256) view returns(address)","function balanceOf(address) view returns(uint256)","function totalSupply() view returns(uint256)","function exists(uint256) view returns(bool)","function approve(address,uint256)","event Approval(address indexed owner,address indexed approved,uint256 indexed tokenId)","event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)"]);
export const reclaim1155Abi=parseAbi(["function balanceOf(address,uint256) view returns(uint256)","function totalSupply(uint256) view returns(uint256)","function setApprovalForAll(address,bool)","event ApprovalForAll(address indexed account,address indexed operator,bool approved)","event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)","event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values)"]);
const coreAbi=parseAbi(["function originCurveForToken(address) view returns(address)","function factory() view returns(address)","function token() view returns(address)"]);
export type ReclaimAsset={address:Address;runtimeHash:Hex;standard:1|2;retirementMode:1|2;policyHash:Hex;items:{tokenId:string;maxQuantity:string}[]};
export type ReclaimDeployment={schemaVersion:2;profile:typeof reclaimProfile;chainId:31337;reclaimFactory:Address;factoryRuntimeHash:Hex;
  coreFactory:Address;coreFactoryRuntimeHash:Hex;rewardToken:Address;rewardTokenRuntimeHash:Hex;campaignCreationCode:Hex;campaignCreationCodeHash:Hex;
  campaignRuntimeTemplate:Hex;campaignImmutableReferences:Record<string,{start:number;length:number}[]>;campaignImmutableNames:Record<string,string>;
  campaignDeployer:Address;deployerRuntimeHash:Hex;permanentSink:Address;sinkRuntimeHash:Hex;retirementProfilesHash:Hex;
  creationPart1:Address;creationPart1RuntimeHash:Hex;creationPart2:Address;creationPart2RuntimeHash:Hex;
  retirementProfiles:{runtimeHash:Hex;standard:1|2;mode:1|2;policyHash:Hex}[];
  deployment:ReclaimPoint&{transactionHash:Hex};compilerInputSha256:string;collections:ReclaimAsset[]};
export type ReclaimFixture={curve:CurveFixture;module:ReclaimDeployment;administration?:ReclaimAdministrationPolicy|null};
export type ReclaimRpc=ReturnType<typeof fixtureRpc>;
export type ReclaimHead=Awaited<ReturnType<ReclaimRpc["getBlock"]>>&{number:bigint;hash:Hex};
export const sameReclaim=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
export const normalizedReclaim=(a:string)=>getAddress(a.toLowerCase());
export function requireReclaim(v:unknown,reason="Reclaim identity or canonical evidence unavailable"):asserts v{if(!v)throw Error(reason);}
export const reclaimPoint=(head:ReclaimHead):ReclaimPoint=>({blockNumber:head.number.toString(),blockHash:head.hash,timestamp:new Date(Number(head.timestamp)*1000).toISOString()});
export async function reclaimRead<T>(rpc:ReclaimRpc,target:Address,abi:readonly unknown[],name:string,args:readonly unknown[],at:bigint):Promise<T>{
  return rpc.readContract({address:target,abi,functionName:name,args,blockNumber:at}as never)as Promise<T>;
}
export function configuredReclaimFixture(headers:Headers):ReclaimFixture|null{
  const curve=configuredCurveFixture(headers);
  if(!curve||headers.has("forwarded")||process.env.RMT_RECLAIM_FIXTURE!==reclaimFixtureFlag)return null;
  try{
    const path=process.env.RMT_RECLAIM_DEPLOYMENT;
    if(!path||!isAbsolute(path)||statSync(path).size>180_000)return null;
    const m=JSON.parse(readFileSync(path,"utf8"))as ReclaimDeployment;
    if(m.schemaVersion!==2||m.profile!==reclaimProfile||m.chainId!==31337||![m.reclaimFactory,m.coreFactory,m.rewardToken,m.campaignDeployer,m.permanentSink,m.creationPart1,m.creationPart2].every(reclaimAddress)
      ||![m.factoryRuntimeHash,m.coreFactoryRuntimeHash,m.rewardTokenRuntimeHash,m.campaignCreationCodeHash,m.deployerRuntimeHash,m.sinkRuntimeHash,m.retirementProfilesHash,m.creationPart1RuntimeHash,m.creationPart2RuntimeHash,m.deployment?.blockHash,m.deployment?.transactionHash].every(reclaimHash)
      ||!sameReclaim(m.coreFactory,curve.factory)||!sameReclaim(m.coreFactoryRuntimeHash,curve.factoryRuntimeHash)
      ||!reclaimUint(m.deployment?.blockNumber)||BigInt(m.deployment.blockNumber)<curve.deploymentBlock||!Number.isFinite(Date.parse(m.deployment.timestamp))
      ||!/^0x(?:[0-9a-f]{2}){1,49152}$/i.test(m.campaignCreationCode)||!sameReclaim(keccak256(m.campaignCreationCode),m.campaignCreationCodeHash)
      ||!/^[0-9a-f]{64}$/.test(m.compilerInputSha256)||!Array.isArray(m.collections)||m.collections.length<1||m.collections.length>16
      ||!Array.isArray(m.retirementProfiles)||m.retirementProfiles.length<1||m.retirementProfiles.length>16)return null;
    for(const p of m.retirementProfiles)if(!reclaimHash(p.runtimeHash)||!reclaimHash(p.policyHash)||![1,2].includes(p.standard)||![1,2].includes(p.mode))return null;
    if(!sameReclaim(retirementProfilesHash(m),m.retirementProfilesHash))return null;
    if(new Set(m.retirementProfiles.map(p=>`${p.runtimeHash.toLowerCase()}:${p.standard}:${p.mode}`)).size!==m.retirementProfiles.length)return null;
    for(const c of m.collections){if(!reclaimAddress(c.address)||!reclaimHash(c.runtimeHash)||!reclaimHash(c.policyHash)||![1,2].includes(c.standard)||![1,2].includes(c.retirementMode)||!Array.isArray(c.items)||c.items.length<1||c.items.length>16
      ||c.items.some(i=>!reclaimUint(i.tokenId)||!reclaimUint(i.maxQuantity)||BigInt(i.maxQuantity)<1n||BigInt(i.maxQuantity)>20n)
      ||new Set(c.items.map(i=>i.tokenId)).size!==c.items.length
      ||!m.retirementProfiles.some(p=>sameReclaim(p.runtimeHash,c.runtimeHash)&&p.standard===c.standard&&p.mode===c.retirementMode&&sameReclaim(p.policyHash,c.policyHash)))return null;}
    if(new Set(m.collections.map(c=>c.address.toLowerCase())).size!==m.collections.length)return null;
    materializeReclaimRuntime(m.campaignRuntimeTemplate,m.campaignImmutableReferences,m.campaignImmutableNames,
      {creator:m.coreFactory,deploymentFactory:m.reclaimFactory,rewardToken:m.rewardToken,rewardRuntimeHash:m.rewardTokenRuntimeHash,deploymentChainId:31337,permanentSink:m.permanentSink,sinkRuntimeHash:m.sinkRuntimeHash});
    return{curve,module:m,administration:configuredReclaimAdministration(m)};
  }catch{return null;}
}
export function reclaimEligibility(config:ReclaimFixture,campaign:Address,collection:Address){
  const asset=config.module.collections.find(c=>sameReclaim(c.address,collection));requireReclaim(asset,"Collection is not in the reviewed fixture manifest");
  const result=buildReclaimEligibility({chainId:31337,campaign,collection:asset.address,runtimeHash:asset.runtimeHash,standard:asset.standard,retirementMode:asset.retirementMode,policyHash:asset.policyHash,items:asset.items},{keccak256,encodeAbiParameters:(p:readonly unknown[],v:readonly unknown[])=>{
    // Shared pure helper supplies the precise Solidity ABI types, never calldata.
    return requireEncoding(p,v);
  }});
  return{asset,...result};
}
// Kept here rather than in the shared browser-safe helper to avoid new SDK dependencies.
function requireEncoding(p:readonly unknown[],v:readonly unknown[]){return encodeAbiParameters(p as never,v as never);}
function retirementProfilesHash(m:ReclaimDeployment){return keccak256(encodeAbiParameters([{type:"tuple[]",components:[{name:"runtimeHash",type:"bytes32"},{name:"standard",type:"uint8"},{name:"mode",type:"uint8"},{name:"policyHash",type:"bytes32"}]}],[m.retirementProfiles]));}
export async function verifyReclaimContext(config:ReclaimFixture){
  const rpc=fixtureRpc(config.curve),head=await verifyCurveFixture(config.curve,rpc)as ReclaimHead,m=config.module;
  requireReclaim(head.number!==null&&head.hash&&await rpc.getChainId()===31337);
  const [code,birthCode,tokenCode,chain,reward,hash,template,receipt,birthBlock,origin,supply,decimals]=await Promise.all([
    rpc.getCode({address:m.reclaimFactory,blockNumber:head.number}),rpc.getCode({address:m.reclaimFactory,blockNumber:BigInt(m.deployment.blockNumber)}),
    rpc.getCode({address:m.rewardToken,blockNumber:head.number}),reclaimRead<bigint>(rpc,m.reclaimFactory,reclaimFactoryAbi,"deploymentChainId",[],head.number),
    reclaimRead<Address>(rpc,m.reclaimFactory,reclaimFactoryAbi,"rewardToken",[],head.number),reclaimRead<Hex>(rpc,m.reclaimFactory,reclaimFactoryAbi,"rewardRuntimeHash",[],head.number),
    reclaimRead<Hex>(rpc,m.reclaimFactory,reclaimFactoryAbi,"campaignCreationCodeHash",[],head.number),rpc.getTransactionReceipt({hash:m.deployment.transactionHash}),
    rpc.getBlock({blockNumber:BigInt(m.deployment.blockNumber)}),reclaimRead<Address>(rpc,m.coreFactory,coreAbi,"originCurveForToken",[m.rewardToken],head.number),
    reclaimRead<bigint>(rpc,m.rewardToken,erc20Abi,"totalSupply",[],head.number),reclaimRead<number>(rpc,m.rewardToken,erc20Abi,"decimals",[],head.number)]);
  requireReclaim(code&&birthCode&&tokenCode&&sameReclaim(keccak256(code),m.factoryRuntimeHash)&&sameReclaim(keccak256(birthCode),m.factoryRuntimeHash)
    &&sameReclaim(keccak256(tokenCode),m.rewardTokenRuntimeHash)&&chain===31337n&&sameReclaim(reward,m.rewardToken)&&sameReclaim(hash,m.rewardTokenRuntimeHash)
    &&sameReclaim(template,m.campaignCreationCodeHash)&&supply===1_000_000_000n*10n**18n&&decimals===18&&reclaimAddress(origin)
    &&receipt.status==="success"&&receipt.to===null&&sameReclaim(receipt.contractAddress!,m.reclaimFactory)&&receipt.blockNumber===BigInt(m.deployment.blockNumber)
    &&sameReclaim(receipt.blockHash,m.deployment.blockHash)&&sameReclaim(birthBlock.hash!,receipt.blockHash)
    &&sameReclaim(birthBlock.transactions[receipt.transactionIndex]as Hex,receipt.transactionHash));
  const[originalToken,originalFactory]=await Promise.all([reclaimRead<Address>(rpc,origin,coreAbi,"token",[],head.number),reclaimRead<Address>(rpc,origin,coreAbi,"factory",[],head.number)]);
  requireReclaim(sameReclaim(originalToken,m.rewardToken)&&sameReclaim(originalFactory,m.coreFactory));
  const[deployerCode,sinkCode,part1,part2,deployer,sink,sinkHash,profilesHash]=await Promise.all([
    rpc.getCode({address:m.campaignDeployer,blockNumber:head.number}),rpc.getCode({address:m.permanentSink,blockNumber:head.number}),
    rpc.getCode({address:m.creationPart1,blockNumber:head.number}),rpc.getCode({address:m.creationPart2,blockNumber:head.number}),
    reclaimRead<Address>(rpc,m.reclaimFactory,reclaimFactoryAbi,"campaignDeployer",[],head.number),reclaimRead<Address>(rpc,m.reclaimFactory,reclaimFactoryAbi,"permanentSink",[],head.number),
    reclaimRead<Hex>(rpc,m.reclaimFactory,reclaimFactoryAbi,"sinkRuntimeHash",[],head.number),reclaimRead<Hex>(rpc,m.reclaimFactory,reclaimFactoryAbi,"retirementProfilesHash",[],head.number)]);
  requireReclaim(deployerCode&&sameReclaim(keccak256(deployerCode),m.deployerRuntimeHash)&&sinkCode&&sameReclaim(keccak256(sinkCode),m.sinkRuntimeHash)
    &&sameReclaim(deployer,m.campaignDeployer)&&sameReclaim(sink,m.permanentSink)&&sameReclaim(sinkHash,m.sinkRuntimeHash)&&sameReclaim(profilesHash,m.retirementProfilesHash)
    &&part1&&part2&&/^0x00(?:[0-9a-f]{2}){1,24575}$/i.test(part1)&&/^0x00(?:[0-9a-f]{2}){1,24575}$/i.test(part2)
    &&sameReclaim(keccak256(part1),m.creationPart1RuntimeHash)&&sameReclaim(keccak256(part2),m.creationPart2RuntimeHash)&&sameReclaim("0x"+part1.slice(4)+part2.slice(4),m.campaignCreationCode));
  const deployerAbi=parseAbi(["function creationPart1() view returns(address)","function creationPart2() view returns(address)","function campaignCreationCodeHash() view returns(bytes32)",
    "function factory() view returns(address)","function rewardToken() view returns(address)","function rewardRuntimeHash() view returns(bytes32)","function permanentSink() view returns(address)","function deploymentChainId() view returns(uint256)","function creationPart1Hash() view returns(bytes32)","function creationPart2Hash() view returns(bytes32)"]);
  requireReclaim(sameReclaim(await reclaimRead<Address>(rpc,m.campaignDeployer,deployerAbi,"creationPart1",[],head.number),m.creationPart1)
    &&sameReclaim(await reclaimRead<Address>(rpc,m.campaignDeployer,deployerAbi,"creationPart2",[],head.number),m.creationPart2)
    &&sameReclaim(await reclaimRead<Hex>(rpc,m.campaignDeployer,deployerAbi,"campaignCreationCodeHash",[],head.number),m.campaignCreationCodeHash));
  const bindings=await Promise.all(["factory","rewardToken","rewardRuntimeHash","permanentSink","deploymentChainId","creationPart1Hash","creationPart2Hash"].map(name=>reclaimRead<unknown>(rpc,m.campaignDeployer,deployerAbi,name,[],head.number)));
  requireReclaim(bindings[4]===31337n&&sameReclaim(String(bindings[0]),m.reclaimFactory)&&sameReclaim(String(bindings[1]),m.rewardToken)&&sameReclaim(String(bindings[2]),m.rewardTokenRuntimeHash)
    &&sameReclaim(String(bindings[3]),m.permanentSink)&&sameReclaim(String(bindings[5]),m.creationPart1RuntimeHash)&&sameReclaim(String(bindings[6]),m.creationPart2RuntimeHash));
  for(const p of m.retirementProfiles)requireReclaim(sameReclaim(await reclaimRead<Hex>(rpc,m.reclaimFactory,reclaimFactoryAbi,"retirementPolicy",[p.runtimeHash,p.standard,p.mode],head.number),p.policyHash));
  return{rpc,head};
}
export type ReclaimProof={campaign:Address;runtimeHash:Hex;creator:Address;initialController:Address;intentId:Hex;initialRewardPerUnit:string;walletCap:string;deployment:ReclaimPoint&{transactionHash:Hex}};
export async function readReclaimProof(config:ReclaimFixture,rpc:ReclaimRpc,campaign:Address,head:ReclaimHead):Promise<ReclaimProof>{
  const m=config.module,start=BigInt(m.deployment.blockNumber);requireReclaim(head.number>=start&&head.number-start<=4096n);
  const logs=await rpc.getLogs({address:m.reclaimFactory,events:reclaimFactoryAbi.filter(v=>v.type==="event"),fromBlock:start,toBlock:head.number});requireReclaim(logs.length<=128);
  const matches=parseEventLogs({abi:reclaimFactoryAbi,eventName:"CampaignCreated",logs,strict:true}).filter(l=>sameReclaim((l.args as {campaign:Address}).campaign,campaign));requireReclaim(matches.length===1);
  const log=matches[0],args=log.args as{creator:Address;campaign:Address;intent:Hex;controller:Address;rewardPerUnit:bigint;walletCap:number};
  requireReclaim(log.blockNumber!==null&&log.blockHash&&log.transactionHash&&log.logIndex!==null&&!log.removed);
  const[receipt,block,tx,code,mapped,predicted]=await Promise.all([rpc.getTransactionReceipt({hash:log.transactionHash}),rpc.getBlock({blockNumber:log.blockNumber}),rpc.getTransaction({hash:log.transactionHash}),rpc.getCode({address:campaign,blockNumber:head.number}),
    reclaimRead<Address>(rpc,m.reclaimFactory,reclaimFactoryAbi,"campaignForIntent",[args.creator,args.intent],head.number),
    reclaimRead<Address>(rpc,m.reclaimFactory,reclaimFactoryAbi,"predict",[args.creator,args.intent,args.controller,args.rewardPerUnit,args.walletCap],head.number)]);
  const materialized=materializeReclaimRuntime(m.campaignRuntimeTemplate,m.campaignImmutableReferences,m.campaignImmutableNames,
    {creator:args.creator,deploymentFactory:m.reclaimFactory,rewardToken:m.rewardToken,rewardRuntimeHash:m.rewardTokenRuntimeHash,deploymentChainId:31337,permanentSink:m.permanentSink,sinkRuntimeHash:m.sinkRuntimeHash});
  requireReclaim(code&&sameReclaim(code,materialized)&&sameReclaim(mapped,campaign)&&sameReclaim(predicted,campaign)&&receipt.status==="success"
    &&sameReclaim(receipt.to!,m.reclaimFactory)&&sameReclaim(tx.to!,m.reclaimFactory)&&sameReclaim(tx.from,args.creator)&&tx.value===0n&&tx.chainId===31337
    &&receipt.blockNumber===log.blockNumber&&tx.blockNumber===receipt.blockNumber&&tx.transactionIndex===receipt.transactionIndex&&sameReclaim(tx.blockHash!,receipt.blockHash)
    &&sameReclaim(tx.input,encodeFunctionData({abi:reclaimFactoryAbi,functionName:"create",args:[args.intent,args.controller,args.rewardPerUnit,args.walletCap]}as never))
    &&sameReclaim(receipt.blockHash,log.blockHash)&&sameReclaim(block.hash!,receipt.blockHash)&&sameReclaim(block.transactions[receipt.transactionIndex]as Hex,tx.hash)
    &&receipt.logs.some(l=>l.logIndex===log.logIndex&&sameReclaim(l.address,m.reclaimFactory)&&sameReclaim(l.data,log.data)&&JSON.stringify(l.topics)===JSON.stringify(log.topics)));
  return{campaign,runtimeHash:keccak256(code),creator:args.creator,initialController:args.controller,intentId:args.intent,initialRewardPerUnit:args.rewardPerUnit.toString(),walletCap:String(args.walletCap),deployment:{...reclaimPoint(block as ReclaimHead),transactionHash:tx.hash}};
}

export async function readReclaimIndexed(config:ReclaimFixture,rpc:ReclaimRpc,head:ReclaimHead,campaign:Address){
  const key=process.env.RMT_CURVE_FIXTURE_READ_KEY;requireReclaim(key&&/^[0-9a-f]{64}$/.test(key));
  const url=new URL("/reclaim-campaigns",config.curve.indexerUrl);url.searchParams.set("campaign",campaign);
  const response=await fetch(url,{headers:{"X-RMT-Fixture-Key":key},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(5000)});
  requireReclaim(response.ok&&response.headers.get("content-type")?.includes("application/json"));
  requireReclaim(response.body);const body=await readTreasuryBody(response.body,128_000)as Record<string,any>;requireReclaim(body.schemaVersion===2&&body.profile===reclaimProfile&&body.status==="ready"&&body.chainId===31337
    &&sameReclaim(body.reclaimFactory,config.module.reclaimFactory)&&sameReclaim(body.rewardToken,config.module.rewardToken)
    &&Array.isArray(body.campaigns)&&body.campaigns.length<=1&&body.campaigns.every((b:{campaign?:unknown})=>reclaimAddress(b.campaign)&&sameReclaim(b.campaign,campaign))
    &&Array.isArray(body.events)&&body.events.length<=100);
  const checkpoint=body.checkpoint;requireReclaim(checkpoint&&reclaimUint(checkpoint.blockNumber)&&reclaimHash(checkpoint.blockHash)&&Number.isFinite(Date.parse(checkpoint.timestamp))
    &&BigInt(checkpoint.blockNumber)>=BigInt(config.module.deployment.blockNumber)&&BigInt(checkpoint.blockNumber)<=head.number&&head.number-BigInt(checkpoint.blockNumber)<=64n
    &&checkpoint.confirmations===2&&checkpoint.finality==="local-synthetic"&&checkpoint.l1Finality==="not-applicable");
  const at=await rpc.getBlock({blockNumber:BigInt(checkpoint.blockNumber)});requireReclaim(sameReclaim(at.hash!,checkpoint.blockHash)&&new Date(Number(at.timestamp)*1000).toISOString()===checkpoint.timestamp);
  const identities=new Set<string>(),receipts=new Map<string,ReturnType<ReclaimRpc["getTransactionReceipt"]>>(),blocks=new Map<string,ReturnType<ReclaimRpc["getBlock"]>>();
  for(const event of body.events){requireReclaim(reclaimHash(event.transactionHash)&&reclaimHash(event.blockHash)&&reclaimUint(event.blockNumber)&&reclaimAddress(event.campaign)&&sameReclaim(event.campaign,campaign)
    &&BigInt(event.blockNumber)>=BigInt(config.module.deployment.blockNumber)&&BigInt(event.blockNumber)<=BigInt(checkpoint.blockNumber)&&Number.isSafeInteger(event.logIndex)&&event.logIndex>=0);
    const txKey=event.transactionHash.toLowerCase(),identity=`${txKey}:${event.logIndex}`;requireReclaim(!identities.has(identity));identities.add(identity);
    if(!receipts.has(txKey))receipts.set(txKey,rpc.getTransactionReceipt({hash:event.transactionHash}));
    const receipt=await receipts.get(txKey)!;requireReclaim(receipt.status==="success"&&sameReclaim(receipt.transactionHash,event.transactionHash)&&sameReclaim(receipt.blockHash,event.blockHash)&&receipt.blockNumber===BigInt(event.blockNumber));
    const matches=receipt.logs.filter(l=>l.logIndex===event.logIndex&&sameReclaim(l.address,campaign));requireReclaim(matches.length===1);
    const log=matches[0];requireReclaim(!log.removed&&sameReclaim(log.transactionHash,receipt.transactionHash)&&sameReclaim(log.blockHash,receipt.blockHash)&&log.blockNumber===receipt.blockNumber&&log.transactionIndex===receipt.transactionIndex);
    const parsed=parseEventLogs({abi:reclaimCampaignAbi,logs:[log],strict:true});requireReclaim(parsed.length===1&&parsed[0].eventName===event.eventName
      &&normalizedReclaimEventArgs(parsed[0].args)===normalizedReclaimEventArgs(event.args));
    if(!blocks.has(event.blockNumber))blocks.set(event.blockNumber,rpc.getBlock({blockNumber:receipt.blockNumber}));
    const block=await blocks.get(event.blockNumber)!;requireReclaim(block.number===receipt.blockNumber&&sameReclaim(block.hash!,receipt.blockHash)
      &&sameReclaim(block.transactions[receipt.transactionIndex]as Hex,receipt.transactionHash)&&new Date(Number(block.timestamp)*1000).toISOString()===event.timestamp);}
  return body;
}

// The worker serializes ABI bigints as canonical decimal strings; normalize
// only key order and hexadecimal casing, never omit or coerce unknown fields.
function normalizedReclaimEventArgs(value:unknown):string{
  const normalize=(v:unknown):unknown=>typeof v==="bigint"?v.toString():typeof v==="string"&&/^0x[0-9a-f]+$/i.test(v)?v.toLowerCase():Array.isArray(v)?v.map(normalize)
    :v&&typeof v==="object"?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,item])=>[k,normalize(item)])):v;
  return JSON.stringify(normalize(value));
}

export async function readReclaimSnapshot(config:ReclaimFixture,campaign:Address,context?:{rpc:ReclaimRpc;head:ReclaimHead}):Promise<ReclaimSnapshot>{
  const{rpc,head}=context??await verifyReclaimContext(config),m=config.module,proof=await readReclaimProof(config,rpc,campaign,head);
  const names=["controller","controllerEpoch","policyEpoch","rewardPerUnit","walletCap","paused","closed","reserve","funded","paid","recovered","unsolicited","outstandingLiability"];
  const values=await Promise.all(names.map(name=>reclaimRead<unknown>(rpc,campaign,reclaimCampaignAbi,name,[],head.number)));
  const state=Object.fromEntries(names.map((n,i)=>[n,values[i]])),controller=state.controller as Address;
  const tokenBalance=await reclaimRead<bigint>(rpc,m.rewardToken,erc20Abi,"balanceOf",[campaign],head.number);
  const reserve=BigInt(state.reserve as bigint),funded=BigInt(state.funded as bigint),paid=BigInt(state.paid as bigint),recovered=BigInt(state.recovered as bigint),unsolicited=BigInt(state.unsolicited as bigint);
  requireReclaim(state.outstandingLiability===0n&&tokenBalance>=reserve&&funded+unsolicited===reserve+paid+recovered);
  const collections:ReclaimSnapshot["collections"]=[];
  for(const asset of m.collections){
    const policy=await reclaimRead<readonly[Hex,Hex,number,number,number,number,Hex,boolean]>(rpc,campaign,reclaimCampaignAbi,"collections",[asset.address],head.number);
    const actualCode=await rpc.getCode({address:asset.address,blockNumber:head.number});requireReclaim(actualCode&&sameReclaim(keccak256(actualCode),asset.runtimeHash));
    const eligibility=reclaimEligibility(config,campaign,asset.address),admitted=policy[0]!=="0x"+"00".repeat(32);
    if(admitted)requireReclaim(sameReclaim(policy[0],asset.runtimeHash)&&policy[4]===asset.standard&&policy[5]===asset.retirementMode&&sameReclaim(policy[6],asset.policyHash)&&sameReclaim(policy[1],eligibility.root));
    const eligibleItems:ReclaimSnapshot["collections"][number]["eligibleItems"]=[];
    if(admitted&&policy[7])for(const item of asset.items){const used=await reclaimRead<bigint>(rpc,campaign,reclaimCampaignAbi,"claimedUnits",[asset.address,BigInt(item.tokenId)],head.number);requireReclaim(used<=BigInt(item.maxQuantity));eligibleItems.push({...item,remainingQuantity:(BigInt(item.maxQuantity)-used).toString()});}
    collections.push({address:asset.address,standard:asset.standard,runtimeHash:asset.runtimeHash,retirementMode:asset.retirementMode,destination:asset.retirementMode===1?zeroAddress:m.permanentSink,policyHash:asset.policyHash,eligibilityRoot:eligibility.root as Hex,enabled:admitted&&policy[7],
      admission:!admitted?"candidate":policy[7]?"admitted":"disabled",collectionCap:String(policy[2]),walletCap:String(policy[3]),acceptedUnits:(await reclaimRead<bigint>(rpc,campaign,reclaimCampaignAbi,"collectionClaimed",[asset.address],head.number)).toString(),eligibleItems});
  }
  const pending:ReclaimNotice[]=[];
  for(const kind of["rate","close","recovery"]as const){const n=await reclaimRead<readonly[bigint,number,number,bigint]>(rpc,campaign,reclaimCampaignAbi,"pending"+kind[0].toUpperCase()+kind.slice(1),[],head.number);
    if(n[1])pending.push({kind,readyAt:String(n[1]),expiresAt:String(n[2]),epoch:n[3].toString(),detail:n[0].toString()});}
  const cn=await reclaimRead<readonly[Address,Hex,Hex,number,number,number,number,Hex,number,number,bigint]>(rpc,campaign,reclaimCampaignAbi,"pendingCollection",[],head.number);
  if(cn[8])pending.push({kind:"collection",readyAt:String(cn[8]),expiresAt:String(cn[9]),epoch:cn[10].toString(),detail:cn[0]});
  const controllerNotice=await reclaimRead<readonly[Address,number,number,bigint]>(rpc,campaign,reclaimCampaignAbi,"pendingController",[],head.number);
  if(controllerNotice[1])pending.push({kind:"controller",readyAt:String(controllerNotice[1]),expiresAt:String(controllerNotice[2]),epoch:controllerNotice[3].toString(),detail:controllerNotice[0]});
  let history:ReclaimSnapshot["history"]={status:"unavailable",indexed:false},receipts:ReclaimSnapshot["receipts"]=[];
  try{const indexed=await readReclaimIndexed(config,rpc,head,campaign);const birth=indexed.campaigns.find((r:{campaign:string})=>sameReclaim(r.campaign,campaign));
    requireReclaim(birth&&sameReclaim(birth.runtimeHash,proof.runtimeHash));history={status:"ready",indexed:true,checkpoint:indexed.checkpoint};
    const accepted=indexed.events.filter((r:{eventName:string})=>r.eventName==="TradeInAccepted");requireReclaim(accepted.length<=100);
    receipts=await Promise.all(accepted.map(async(event:{args:{receiptId:string};transactionHash:Hex;blockNumber:string;blockHash:Hex;timestamp:string})=>{
      const id=BigInt(event.args.receiptId),r=await reclaimRead<readonly[Address,Address,number,bigint,bigint,number,number,number,Address]>(rpc,campaign,reclaimCampaignAbi,"tradeIns",[id],head.number);
      const items=await reclaimRead<readonly[readonly bigint[],readonly bigint[]]>(rpc,campaign,reclaimCampaignAbi,"receiptItems",[id],head.number);requireReclaim(r[6]===1&&[1,2].includes(r[7]));
      const asset=m.collections.find(c=>sameReclaim(c.address,r[1])&&c.standard===r[2]&&c.retirementMode===r[7]);requireReclaim(asset&&sameReclaim(r[8],r[7]===1?zeroAddress:m.permanentSink));
      return{id:id.toString(),claimant:r[0],collection:r[1],standard:r[2]as 1|2,tokenIds:items[0].map(String),quantities:items[1].map(String),rewardWei:r[4].toString(),retirementMode:r[7]as 1|2,destination:r[8],policyHash:asset.policyHash,
        transactionHash:event.transactionHash,canonical:{blockNumber:event.blockNumber,blockHash:event.blockHash,timestamp:event.timestamp}};
    }));
  }catch{history={status:"pending",indexed:false};}
  return{schemaVersion:2,profile:reclaimProfile,status:"ready",chainId:31337,scope:"isolated-local",executionEnabled:false,
    factory:m.reclaimFactory,factoryRuntimeHash:m.factoryRuntimeHash,campaign,runtimeHash:proof.runtimeHash,creator:proof.creator,controller,
    controllerEpoch:String(state.controllerEpoch),policyEpoch:String(state.policyEpoch),controllerKind:await projectTreasuryControllerKind(rpc,controller,head.number),
    rewardToken:m.rewardToken,rewardRuntimeHash:m.rewardTokenRuntimeHash,rewardDecimals:18,rewardSymbol:"Synthetic RMT",rewardMode:"fixed-token-units",rewardPerUnit:String(state.rewardPerUnit),walletCap:String(state.walletCap),
    paused:state.paused as boolean,closed:state.closed as boolean,reserve:{heldWei:tokenBalance.toString(),availableWei:reserve.toString(),fundedWei:funded.toString(),paidWei:paid.toString(),recoveredWei:recovered.toString(),unsolicitedWei:unsolicited.toString(),liabilityWei:"0"},
    collections,receipts,pending,history,administration:await reclaimAdministrationEvidence(config,rpc,head,campaign,controller),observed:reclaimPoint(head),notices:["Local synthetic campaign; no live RMT or USD-priced reward exists.","Permanent surrender: an approved native burn destroys these NFT units; an approved immutable sink permanently removes them from circulation without calling it a burn. No returns or buyback exist.","Only source-reviewed immutable collection profiles and finite IDs are admitted. An unknown issuer, upgrade, seizure or remint path makes a collection unsupported.","No creator fees, protocol treasuries or royalties fund this campaign automatically."]};
}
