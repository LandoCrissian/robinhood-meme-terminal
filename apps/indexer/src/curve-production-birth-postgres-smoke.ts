import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {Client} from "pg";
import {encodeAbiParameters, keccak256, type Address, type Hex, type PublicClient} from "viem";
import {curveProductionConfig} from "./curve-production-config.js";
import {createProductionCurveIndexer} from "./curve-production.js";
import {curveProductionSchemaSql, productionCurveScope} from "./curve-production-store.js";
import {productionActivitySchemaSql, productionActivityCursor} from "./curve-production-activity.js";
import {indexerBirthDeployment as d,indexerBirthPins as pins,isPrunedIndexerBirthState} from "./curve-production-birth.js";
const url=new URL(process.env.DATABASE_URL??"http://invalid");
if(!["127.0.0.1","localhost"].includes(url.hostname)||!/^\/rmt_curve_production_smoke_[a-z0-9_]+$/.test(url.pathname))throw Error("Fresh loopback synthetic PostgreSQL required");
const root=new URL("../../../",import.meta.url),load=(path:string)=>JSON.parse(gunzipSync(readFileSync(new URL(path,root))).toString());
const bootstrap=load("docs/evidence/rmt-task092/source/current/RMTLaunchCurveDeploymentV2.metadata.json.gz");
const codes=new Map<string,Hex>([[pins.bootstrap[0].toLowerCase(),bootstrap.deployed_bytecode],
 [pins.factory[0].toLowerCase(),load("docs/evidence/rmt-task092/source/current-tail/RMTLaunchCurveFactoryV2.metadata.json.gz").deployed_bytecode],
 [pins.engine[0].toLowerCase(),load("docs/evidence/rmt-task092/source/current-tail/RMTV4CurveGraduationV1.metadata.json.gz").deployed_bytecode],
 [pins.guard[0].toLowerCase(),load("docs/evidence/rmt-task092/source/current/RMTV4CurveInitializationGuardV1.metadata.json.gz").deployed_bytecode]]);
const governance=load("docs/evidence/rmt-task092/governance/current/capture.json.gz");
const registryRead=governance.requests.find((r:{request:{method:string;params:string[]}})=>r.request.method==="eth_getCode"&&r.request.params[0]!.toLowerCase()===pins.registry[0].toLowerCase());
codes.set(pins.registry[0].toLowerCase(),JSON.parse(registryRead.rawUtf8).result);
const compilation=load("docs/evidence/rmt-task090/migration/canonical-compilation.json.gz");
const registryInput=(compilation.artifacts.RMTLaunchProjectRegistryV3.bytecode+encodeAbiParameters([{type:"address"}],["0xE677A69A8124714DD0d88b73BDf1B89cc791ca9C"]).slice(2)) as Hex;
assert.equal(keccak256(registryInput),d.registry.initcodeHash);
const config=curveProductionConfig({RMT_CURVE_PRODUCTION_BINDING:JSON.stringify({schemaVersion:1,chainId:4663,profile:"rmt-curve-fixed-supply-security-v2",
 evidence:"CANONICAL_DEPLOYMENT_AND_SOURCE_VERIFIED",factory:pins.factory[0],factoryRuntimeHash:pins.factory[1],projectRegistry:pins.registry[0],registryRuntimeHash:pins.registry[1],
 deploymentBlock:String(d.blockNumber),deploymentBlockHash:d.blockHash,deploymentTransactionHash:d.transactionHash,operatingRecipient:d.operating,reserveRecipient:d.reserve,
 creationFeeWei:"400000000000000",sourceVerificationEvidenceSha256:"66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10"})})!;
const scope=productionCurveScope(config),pointHash=(n:bigint)=>`0x${n.toString(16).padStart(64,"0")}` as Hex;
let head=d.blockNumber+50n,mode="pruned",peerConflict:null|"primary"|"secondary"=null,factoryLogQueries=0,activityHistoricalCalls=0;
const now=Date.now(),time=BigInt(Math.floor(now/1000));
const pruned=()=>Object.assign(new Error("historical state "+"a".repeat(64)+" is not available"),{code:-32000});
function rpc(peer:boolean):PublicClient{return{
 getChainId:async()=>4663,getBlockNumber:async()=>head,
 getBlock:async({blockNumber:n}:{blockNumber:bigint})=>({number:n,hash:n===d.blockNumber?d.blockHash:n===d.registry.blockNumber?d.registry.blockHash:pointHash(n),
  timestamp:time-(d.blockNumber+30n-n),transactions:n===d.blockNumber?[d.transactionHash]:n===d.registry.blockNumber?[d.registry.transactionHash]:[]}),
 getTransaction:async({hash}:{hash:Hex})=>{const registry=hash===d.registry.transactionHash,p=registry?d.registry:d;return{hash,chainId:4663,to:null,from:d.sender,nonce:p.nonce,value:0n,
  input:registry?registryInput:bootstrap.creation_bytecode,blockNumber:p.blockNumber,blockHash:p.blockHash,transactionIndex:0};},
 getTransactionReceipt:async({hash}:{hash:Hex})=>{const registry=hash===d.registry.transactionHash,p=registry?d.registry:d;return{transactionHash:hash,status:"success",contractAddress:registry?pins.registry[0]:pins.bootstrap[0],
  blockNumber:p.blockNumber,blockHash:p.blockHash,transactionIndex:0};},
 getCode:async({address,blockNumber}:{address:Address;blockNumber:bigint})=>{
  if(blockNumber<=d.blockNumber){
   if(mode==="wrong"&&blockNumber===d.blockNumber&&address.toLowerCase()===pins.factory[0].toLowerCase())return"0x6000";
   if(mode==="empty"&&blockNumber===d.blockNumber&&address.toLowerCase()===pins.factory[0].toLowerCase())return"0x";
   if(mode==="quota")throw Object.assign(new Error("HTTP 429"),{status:429});
   throw pruned();
  }
  if((peerConflict==="secondary"&&peer||peerConflict==="primary"&&!peer)&&address.toLowerCase()===pins.bootstrap[0].toLowerCase())return"0x6000";
  return codes.get(address.toLowerCase());
 },
 readContract:async({address,functionName,blockNumber}:{address:Address;functionName:string;blockNumber:bigint})=>{
  if(blockNumber<=d.blockNumber){if(functionName==="graduationEngine")activityHistoricalCalls++;throw pruned();}
  if(address.toLowerCase()===pins.bootstrap[0].toLowerCase())return({factory:pins.factory[0],graduationEngine:pins.engine[0],initializationGuard:pins.guard[0]} as Record<string,unknown>)[functionName];
  return({engineVersion:1,projectRegistry:pins.registry[0],creationFeeWei:400000000000000n,operatingRecipient:d.operating,futureReserveRecipient:d.reserve,tokenSupply:10n**27n} as Record<string,unknown>)[functionName];
 },
 getLogs:async()=>{factoryLogQueries++;return[];},
}as unknown as PublicClient;}
const primary=rpc(false),secondary=rpc(true),db=new Client({connectionString:url.toString()});let closed=false;
try{
 await db.connect();assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'")).rows[0]?.n,0);
 await db.query(curveProductionSchemaSql);await db.query(productionActivitySchemaSql);
 assert.equal(isPrunedIndexerBirthState(pruned()),true);
 assert.equal(isPrunedIndexerBirthState({code:-32000,cause:{message:pruned().message}}),false);
 for(const error of [new Error(pruned().message),Object.assign(pruned(),{status:403}),Object.assign(pruned(),{status:429}),new Error("timeout")])assert.equal(isPrunedIndexerBirthState(error),false);
 for(const rejected of["wrong","empty","quota"]){mode=rejected;const worker=createProductionCurveIndexer(config,db,primary,secondary,()=>now);await assert.rejects(worker.syncOnce());assert.equal(worker.state().status,"unavailable");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM rmt_curve_production_bindings")).rows[0]?.n,0,"No cursor initialization after failed proof");}
 mode="pruned";
 for(const peer of["primary","secondary"]as const){peerConflict=peer;
  await assert.rejects(createProductionCurveIndexer(config,db,primary,secondary,()=>now).syncOnce(),/runtime mismatch/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM rmt_curve_production_bindings")).rows[0]?.n,0);}
 peerConflict=null;
 let worker=createProductionCurveIndexer(config,db,primary,secondary,()=>now);await worker.syncOnce();await worker.syncActivity();
 assert.equal(worker.state().status,"ready");assert.equal(worker.state().checkpoint?.blockNumber,String(d.blockNumber+30n));
 assert.equal(await productionActivityCursor(db,scope),d.blockNumber+31n);
 assert.ok(factoryLogQueries>=4,"Both actual main and activity paths scan factory logs");assert.equal(activityHistoricalCalls,0,"Empty activity does not require historic dependency state");
 assert.equal((await worker.readActivity(db,{transactionHash:pointHash(77n)})).events.length,0,"A checkpoint never invents an activity row");
 await db.end();closed=true;
 const reopened=new Client({connectionString:url.toString()});await reopened.connect();
 try{
  worker=createProductionCurveIndexer(config,reopened,primary,secondary,()=>now);await worker.syncOnce();await worker.syncActivity();assert.equal(worker.state().status,"ready");
  head++;await worker.syncOnce();await worker.syncActivity();assert.equal(worker.state().checkpoint?.blockNumber,String(d.blockNumber+31n));
  assert.equal(await productionActivityCursor(reopened,scope),d.blockNumber+32n);
  assert.equal((await reopened.query("SELECT count(*)::int AS n FROM rmt_curve_production_launches")).rows[0]?.n,0);
  assert.equal((await reopened.query("SELECT to_regclass('public.indexer_state') AS old")).rows[0]?.old,null);
 }finally{await reopened.end();}
 console.info("Task092 actual production worker PostgreSQL startup/sync/restart: exact one-shot+registry birth under typed pruned state; wrong/empty/quota/peer-conflict rejection; canonical empty-history activity backfill, no manual cursor seed and no production access passed.");
}finally{if(!closed)await db.end().catch(()=>undefined);}
