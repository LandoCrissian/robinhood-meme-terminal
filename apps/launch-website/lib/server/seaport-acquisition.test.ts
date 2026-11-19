import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {configuredSeaportAcquisition} from "./seaport-acquisition";
import {handleSeaportAcquisitionRead,handleSeaportAcquisitionTest} from "./seaport-acquisition-actions";
const a=(n:number)=>"0x"+n.toString(16).padStart(40,"1"),h=(n:number)=>"0x"+n.toString(16).padStart(64,"1");
test("Seaport V2 public route denies all reads and financial requests before RPC or wallet capability",async()=>{
  const saved=process.env.RMT_SEAPORT_ACQUISITION_FIXTURE;delete process.env.RMT_SEAPORT_ACQUISITION_FIXTURE;
  try{for(const method of["GET","HEAD","POST"]){const request=new Request("https://rmt.example/api/seaport-acquisition",{method,headers:{host:"rmt.example",origin:"https://rmt.example","content-type":"application/json"},...(method==="POST"&&{body:JSON.stringify({action:"prepare",operation:"buy"})})});const response=await(method==="POST"?handleSeaportAcquisitionTest:handleSeaportAcquisitionRead)(request);assert.equal(response.status,404);assert.equal(response.headers.get("cache-control"),"no-store");}}
  finally{if(saved!==undefined)process.env.RMT_SEAPORT_ACQUISITION_FIXTURE=saved;}
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
