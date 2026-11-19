import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {configuredSeaportAcquisition} from "./seaport-acquisition";
import {handleSeaportAcquisitionRead,handleSeaportAcquisitionTest} from "./seaport-acquisition-actions";
import {saveSeaportJournal,loadSeaportJournal} from "../seaport-acquisition-recovery";
import {seaportAcquisitionReviewHash,type SeaportAcquisitionReview} from "../seaport-acquisition";
import {NextRequest} from "next/server";
import {middleware} from "../../middleware";
const a=(n:number)=>"0x"+n.toString(16).padStart(40,"1"),h=(n:number)=>"0x"+n.toString(16).padStart(64,"1");
test("Seaport V2 public route denies all reads and financial requests before RPC or wallet capability",async()=>{
  const saved=process.env.RMT_SEAPORT_ACQUISITION_FIXTURE;delete process.env.RMT_SEAPORT_ACQUISITION_FIXTURE;
  try{for(const method of["GET","HEAD","POST"]){const request=new Request("https://rmt.example/api/seaport-acquisition",{method,headers:{host:"rmt.example",origin:"https://rmt.example","content-type":"application/json"},...(method==="POST"&&{body:JSON.stringify({action:"prepare",operation:"buy"})})});const response=await(method==="POST"?handleSeaportAcquisitionTest:handleSeaportAcquisitionRead)(request);assert.equal(response.status,404);assert.equal(response.headers.get("cache-control"),"no-store");}}
  finally{if(saved!==undefined)process.env.RMT_SEAPORT_ACQUISITION_FIXTURE=saved;}
});
test("V2 middleware forwards only exact review routes to their full public-404 gates",()=>{
 for(const[path,methods]of[["/api/seaport-acquisition",["GET","HEAD","POST"]],["/my-launches/treasury/seaport-purchases",["GET","HEAD"]]]as const){for(const method of methods){const response=middleware(new NextRequest("http://127.0.0.1:4201"+path,{method}));assert.equal(response.headers.get("x-middleware-next"),"1");}for(const method of["PUT","DELETE","PATCH"]){assert.equal(middleware(new NextRequest("http://127.0.0.1:4201"+path,{method})).status,404);}}
 for(const path of["/api/seaport-acquisition/execute","/api/seaport-acquisition-other","/my-launches/treasury/seaport-purchases/execute"])assert.equal(middleware(new NextRequest("http://127.0.0.1:4201"+path)).status,404);
});
test("V2 recovery retains the original account and vault across context changes and rejects tampering",()=>{
 const map=new Map<string,string>(),storage={get length(){return map.size;},getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},key:(i:number)=>[...map.keys()][i]??null,removeItem:(k:string)=>{map.delete(k);},clear:()=>map.clear()}as Storage;
 const actor=a(1)as `0x${string}`,vault=a(2)as `0x${string}`,body={schemaVersion:1,profile:"rmt-seaport-acquisition-local-v2",chainId:31337,scope:"synthetic-local",productionExecution:false,operation:"disable",account:actor,vault,runtimeHash:h(1),controllerEpoch:"1",policyEpoch:"1",expiresAt:1_900_000_000,fields:{},request:{type:"0x2",chainId:"0x7a69",from:actor,to:vault,data:"0x01020304",value:"0x0",nonce:"0x1",gas:"0x5208",maxFeePerGas:"0x1",maxPriorityFeePerGas:"0x0"},maximumNetworkFeeWei:"21000",listing:null}as Omit<SeaportAcquisitionReview,"reviewHash">;
 const review={...body,reviewHash:seaportAcquisitionReviewHash(body)},saved=saveSeaportJournal(storage,{review,stage:"hash-missing"});
 assert.equal(loadSeaportJournal(storage,vault)?.review.account,actor);assert.equal(loadSeaportJournal(storage,a(3)),undefined);assert.equal(map.size,1);
 const key=[...map.keys()][0]!;assert.ok(key.includes(vault.toLowerCase())&&key.includes(actor.toLowerCase()));storage.setItem(key,JSON.stringify({...saved,review:{...review,request:{...review.request,nonce:"0x2"}}}));assert.equal(loadSeaportJournal(storage,vault),undefined);assert.equal(map.size,1,"Malformed original bytes remain preserved");
});
test("Seaport V2 admission binds exact local manifest, three distinct loopback origins and nonhosted process",()=>{
 const dir=mkdtempSync(join(tmpdir(),"rmt-seaport-gate-")),path=join(dir,"manifest.json"),original={...process.env};
 const manifest={schemaVersion:1,profile:"rmt-seaport-acquisition-local-v2",chainId:31337,vault:a(1),vaultRuntimeHash:h(1),checks:a(2),checksRuntimeHash:h(2),seaport:a(3),seaportRuntimeHash:h(3),paymentToken:a(4),paymentTokenRuntimeHash:h(4),coreFactory:a(5),coreFactoryRuntimeHash:h(5),projectToken:a(6),creator:a(7),collections:[{address:a(8),standard:721,runtimeHash:h(8)}],deployment:{blockNumber:"10",blockHash:h(9),transactionHash:h(10)},compilerInputSha256:"a".repeat(64)};
 try{for(const name of["NETLIFY","VERCEL","DEPLOY_ID","CONTEXT","RAILWAY_ENVIRONMENT_ID"])delete process.env[name];Object.assign(process.env,{RMT_SEAPORT_ACQUISITION_FIXTURE:"local-reviewed-seaport-acquisition-v2",RMT_SEAPORT_ACQUISITION_SITE:"http://127.0.0.1:4201",RMT_SEAPORT_ACQUISITION_RPC:"http://127.0.0.1:4202",RMT_SEAPORT_ACQUISITION_INDEXER:"http://127.0.0.1:4203",RMT_SEAPORT_ACQUISITION_READ_KEY:"a".repeat(64),RMT_SEAPORT_ACQUISITION_MANIFEST:path});writeFileSync(path,JSON.stringify(manifest));const headers=new Headers({host:"127.0.0.1:4201"});assert.ok(configuredSeaportAcquisition(headers));
  for(const[name,value]of Object.entries({NETLIFY:"true",VERCEL:"1",RAILWAY_ENVIRONMENT_ID:"isolated-hosted",RMT_SEAPORT_ACQUISITION_RPC:"https://rpc.example",RMT_SEAPORT_ACQUISITION_INDEXER:"http://127.0.0.1:4201",RMT_SEAPORT_ACQUISITION_READ_KEY:"0".repeat(64),RMT_SEAPORT_ACQUISITION_MANIFEST:"relative.json"})){const before=process.env[name];process.env[name]=value;assert.equal(configuredSeaportAcquisition(headers),null,name);if(before===undefined)delete process.env[name];else process.env[name]=before;}
  for(const extra of([{forwarded:"host=127.0.0.1:4201"},{"x-forwarded-host":"attacker.example"},{"x-forwarded-proto":"https"}] as Record<string,string>[]))assert.equal(configuredSeaportAcquisition(new Headers({host:"127.0.0.1:4201",...extra})),null);
  for(const mutation of[{chainId:4663},{profile:"production"},{checksRuntimeHash:h(0).replaceAll("1","0")},{collections:[]},{deployment:{...manifest.deployment,blockNumber:"0"}}]){writeFileSync(path,JSON.stringify({...manifest,...mutation}));assert.equal(configuredSeaportAcquisition(headers),null);}
 }finally{for(const name of Object.keys(process.env))if(!(name in original))delete process.env[name];Object.assign(process.env,original);rmSync(dir,{recursive:true,force:true});}
});
