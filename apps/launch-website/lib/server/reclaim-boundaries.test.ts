import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync,rmdirSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeAbiParameters,encodeEventTopics,keccak256,type Address,type Hex } from "viem";
import { configuredReclaimFixture,readReclaimIndexed,reclaimCampaignAbi,type ReclaimFixture,type ReclaimHead,type ReclaimRpc } from "./reclaim-fixture";
import { handleReclaimRead,handleReclaimTest,prepareReclaim } from "./reclaim-actions";
import { launchTokenSupplyWei } from "../launch-terms";

const addr=(n:number)=>`0x${(0x2000000000000000000000000000000000000000n+BigInt(n)).toString(16)}`as Address;
const hash=(n:number)=>`0x${n.toString(16).padStart(64,"0")}`as Hex;
const campaign=addr(77),controller=addr(78),key="a".repeat(64),stamp="2027-01-15T08:00:00.000Z";
function fixture(){
  const core={profile:"rmt-curve-fixed-supply-security-v2",chainId:31337,fixedSupplyWei:launchTokenSupplyWei.toString(),factory:addr(1),factoryRuntimeHash:hash(1),projectRegistry:addr(2),registryRuntimeHash:hash(2),deploymentBlockHash:hash(3),deployBlock:"1",creationFeeWei:"400000000000000",creationFeeRecipient:addr(3)};
  const module={schemaVersion:2 as const,profile:"rmt-reclaim-v2-permanent"as const,chainId:31337 as const,reclaimFactory:addr(4),factoryRuntimeHash:hash(4),coreFactory:core.factory,coreFactoryRuntimeHash:core.factoryRuntimeHash,
    rewardToken:addr(5),rewardTokenRuntimeHash:hash(5),campaignCreationCode:"0x6000"as Hex,campaignCreationCodeHash:keccak256("0x6000"),campaignRuntimeTemplate:`0x${"00".repeat(224)}`as Hex,
    campaignImmutableReferences:{"1":[{start:0,length:32}],"2":[{start:32,length:32}],"3":[{start:64,length:32}],"4":[{start:96,length:32}],"5":[{start:128,length:32}],"6":[{start:160,length:32}],"7":[{start:192,length:32}]},
    campaignImmutableNames:{"1":"creator","2":"rewardToken","3":"rewardRuntimeHash","4":"deploymentChainId","5":"deploymentFactory","6":"permanentSink","7":"sinkRuntimeHash"},
    campaignDeployer:addr(12),deployerRuntimeHash:hash(12),permanentSink:addr(13),sinkRuntimeHash:hash(13),retirementProfilesHash:keccak256(encodeAbiParameters([{type:"tuple[]",components:[{name:"runtimeHash",type:"bytes32"},{name:"standard",type:"uint8"},{name:"mode",type:"uint8"},{name:"policyHash",type:"bytes32"}]}],[[{runtimeHash:hash(8),standard:1,mode:1,policyHash:hash(22)}]])),
    creationPart1:addr(14),creationPart1RuntimeHash:hash(15),creationPart2:addr(15),creationPart2RuntimeHash:hash(16),
    retirementProfiles:[{runtimeHash:hash(8),standard:1 as const,mode:1 as const,policyHash:hash(22)}],
    deployment:{transactionHash:hash(6),blockNumber:"2",blockHash:hash(7),timestamp:stamp},compilerInputSha256:"b".repeat(64),collections:[{address:addr(6),runtimeHash:hash(8),standard:1 as const,retirementMode:1 as const,policyHash:hash(22),items:[{tokenId:"11",maxQuantity:"1"}]}]};
  const config:ReclaimFixture={curve:{origin:"http://127.0.0.1:4501",rpcUrl:"http://127.0.0.1:4502",indexerUrl:"http://127.0.0.1:4503",factory:core.factory,factoryRuntimeHash:core.factoryRuntimeHash,
    registry:core.projectRegistry,registryRuntimeHash:core.registryRuntimeHash,deploymentBlock:1n,deploymentBlockHash:core.deploymentBlockHash,feeRecipient:core.creationFeeRecipient},module};
  return{core,module,config};
}
async function envFixture(run:(context:ReturnType<typeof fixture>&{directory:string;modulePath:string})=>Promise<void>){
  const original={...process.env},directory=mkdtempSync(join(tmpdir(),"rmt-reclaim-boundary-")),corePath=join(directory,"core.json"),modulePath=join(directory,"module.json"),f=fixture();
  try{for(const name of["NETLIFY","VERCEL","DEPLOY_ID","CONTEXT","RAILWAY_ENVIRONMENT_ID"])delete process.env[name];
    Object.assign(process.env,{RMT_CURVE_FIXTURE:"rmt-curve-fixed-supply-security-v2",RMT_CURVE_FIXTURE_READ_KEY:key,RMT_CURVE_FIXTURE_SITE_ORIGIN:f.config.curve.origin,
      RMT_CURVE_FIXTURE_RPC:f.config.curve.rpcUrl,RMT_CURVE_FIXTURE_INDEXER:f.config.curve.indexerUrl,RMT_CURVE_FIXTURE_DEPLOYMENT:corePath,RMT_RECLAIM_FIXTURE:"local-reviewed-reclaim-v2-permanent",RMT_RECLAIM_DEPLOYMENT:modulePath});
    writeFileSync(corePath,JSON.stringify(f.core));writeFileSync(modulePath,JSON.stringify(f.module));await run({...f,directory,modulePath});
  }finally{for(const name of Object.keys(process.env))if(!(name in original))delete process.env[name];Object.assign(process.env,original);rmSync(corePath,{force:true});rmSync(modulePath,{force:true});rmdirSync(directory);}
}
test("Reclaim fixture admission fails closed for hosted flags, proxy origin, malformed identity, public RPC and oversized manifests",async()=>envFixture(async({module,modulePath})=>{
  const headers=new Headers({host:"127.0.0.1:4501"});assert.ok(configuredReclaimFixture(headers));
  for(const name of["NETLIFY","VERCEL","DEPLOY_ID","CONTEXT","RAILWAY_ENVIRONMENT_ID"]){process.env[name]="enabled";assert.equal(configuredReclaimFixture(headers),null,name);delete process.env[name];}
  for(const extra of[{forwarded:"host=evil.test"},{"x-forwarded-host":"evil.test"},{"x-forwarded-proto":"https"},{host:"www.rmtlaunch.fun"}]as Record<string,string>[])assert.equal(configuredReclaimFixture(new Headers({host:"127.0.0.1:4501",...extra})),null);
  for(const value of[{...module,chainId:4663},{...module,schemaVersion:1,profile:"rmt-reclaim-v1"},{...module,coreFactory:addr(99)},
    {...module,retirementProfilesHash:hash(99)},{...module,collections:[{...module.collections[0],retirementMode:3}]},
    {...module,collections:[{...module.collections[0],policyHash:hash(99)}]},
    {...module,collections:[...module.collections,...module.collections]},{...module,campaignImmutableNames:{"1":"unknown"}}]){
    writeFileSync(modulePath,JSON.stringify(value));assert.equal(configuredReclaimFixture(headers),null);}
  writeFileSync(modulePath," ".repeat(180001));assert.equal(configuredReclaimFixture(headers),null);writeFileSync(modulePath,JSON.stringify(module));
  process.env.RMT_CURVE_FIXTURE_RPC="https://public-rpc.example";assert.equal(configuredReclaimFixture(headers),null);
}));
test("public Reclaim never prepares execution and local endpoints reject foreign origins, malformed methods and unbounded bodies without RPC calls",async()=>envFixture(async({config})=>{
  let calls=0;const fetch=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw Error("Unexpected outbound request");};
  try{const publicRequest=new Request("https://www.rmtlaunch.fun/api/launchpad/test-reclaim",{method:"POST",headers:{host:"www.rmtlaunch.fun","content-type":"application/json"},body:"{}"});
    const blocked=await handleReclaimTest(publicRequest);assert.equal(blocked.status,404);assert.equal((await blocked.json()).executionEnabled,false);
    const read=await handleReclaimRead(new Request("https://www.rmtlaunch.fun/api/launchpad/reclaim",{headers:{host:"www.rmtlaunch.fun"}}));assert.equal((await read.json()).status,"unavailable");
    for(const [headers,status]of[[{origin:"http://evil.test"},403],[{origin:config.curve.origin,"content-type":"text/plain"},400],[{origin:config.curve.origin,"content-length":"65537"},400]]as const){
      const request=new Request(`${config.curve.origin}/api/launchpad/test-reclaim`,{method:"POST",headers:{host:"127.0.0.1:4501","content-type":"application/json",...headers},body:"{}"});assert.equal((await handleReclaimTest(request)).status,status);}
    const bad=new Request(`${config.curve.origin}/api/launchpad/test-reclaim`,{method:"POST",headers:{host:"127.0.0.1:4501",origin:config.curve.origin,"content-type":"application/json"},body:JSON.stringify({action:"prepare",operation:"fund",account:addr(12),fields:{amountWei:"0"}})});
    assert.equal((await(await handleReclaimTest(bad)).json()).status,"unavailable");
    await assert.rejects(prepareReclaim(config,{operation:"fund",account:"0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA",fields:{amountWei:"1"}}));assert.equal(calls,0);
    for(const operation of["return","approve-return","returnTradeIn"]){const request=new Request(`${config.curve.origin}/api/launchpad/test-reclaim`,{method:"POST",headers:{host:"127.0.0.1:4501",origin:config.curve.origin,"content-type":"application/json"},body:JSON.stringify({action:"prepare",operation,account:addr(12),campaign,fields:{receiptId:"1"}})});
      const result=await(await handleReclaimTest(request)).json();assert.notEqual(result.status,"prepared");assert.equal(result.executionEnabled,false);}
    assert.equal(calls,0,"Removed return routes must not reach any RPC or wallet");
  }finally{globalThis.fetch=fetch;}
}));
test("indexed Reclaim history binds event name, complete normalized args, claimant campaign, timestamp and exact canonical receipt identity",async()=>envFixture(async({config})=>{
  const block={number:10n,hash:hash(10),timestamp:1_800_000_000n,transactions:[hash(20)]},head={...block,number:12n}as ReclaimHead;
  const log={address:campaign,topics:encodeEventTopics({abi:reclaimCampaignAbi,eventName:"Funded",args:{controller}}),data:encodeAbiParameters([{type:"uint256"}],[100n]),
    blockNumber:10n,blockHash:hash(10),transactionHash:hash(20),transactionIndex:0,logIndex:1,removed:false};
  const receipt={status:"success",blockNumber:10n,blockHash:hash(10),transactionHash:hash(20),transactionIndex:0,logs:[log]};
  const row={campaign,transactionHash:hash(20),logIndex:1,eventName:"Funded",args:{amount:"100",controller:controller.toUpperCase().replace("0X","0x")},blockNumber:"10",blockHash:hash(10),timestamp:new Date(Number(block.timestamp)*1000).toISOString()};
  const body=()=>({schemaVersion:2,profile:"rmt-reclaim-v2-permanent",status:"ready",chainId:31337,reclaimFactory:config.module.reclaimFactory,rewardToken:config.module.rewardToken,
    campaigns:[{campaign}],events:[structuredClone(row)],checkpoint:{blockNumber:"10",blockHash:hash(10),timestamp:row.timestamp,confirmations:2,finality:"local-synthetic",l1Finality:"not-applicable"}});
  const rpc={getBlock:async()=>block,getTransactionReceipt:async()=>receipt}as unknown as ReclaimRpc;
  const fetch=globalThis.fetch;let response=body();
  globalThis.fetch=async(input,init)=>{const url=new URL(String(input));assert.equal(url.pathname,"/reclaim-campaigns");assert.equal(url.searchParams.get("campaign"),campaign);
    assert.equal(new Headers(init?.headers).get("X-RMT-Fixture-Key"),key);return Response.json(response);};
  try{assert.equal((await readReclaimIndexed(config,rpc,head,campaign)).events[0].eventName,"Funded");
    for(const mutate of[(v:ReturnType<typeof body>)=>{v.events[0].eventName="TradeInAccepted";},(v:ReturnType<typeof body>)=>{v.events[0].args.amount="101";},
      (v:ReturnType<typeof body>)=>{Object.assign(v.events[0].args,{extra:"invented"});},(v:ReturnType<typeof body>)=>{v.events[0].timestamp="2027-01-15T08:00:01.000Z";},
      (v:ReturnType<typeof body>)=>{v.events[0].campaign=addr(99);},(v:ReturnType<typeof body>)=>{v.events.push(v.events[0]);},
      (v:ReturnType<typeof body>)=>{v.events[0].logIndex=-1;},(v:ReturnType<typeof body>)=>{v.checkpoint.confirmations=0;}]){response=body();mutate(response);await assert.rejects(readReclaimIndexed(config,rpc,head,campaign));}
    response=body();receipt.logs[0].removed=true;await assert.rejects(readReclaimIndexed(config,rpc,head,campaign));receipt.logs[0].removed=false;
    response=body();receipt.transactionHash=hash(99);await assert.rejects(readReclaimIndexed(config,rpc,head,campaign));
  }finally{globalThis.fetch=fetch;}
}));
