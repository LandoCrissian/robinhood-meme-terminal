import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { ABI, DIRECTORY, DIGEST, ZERO, ZERO_ADDRESS } from "./review-packet.mjs";
const require = createRequire(new URL("../../../../apps/launch-website/package.json",import.meta.url));
const { parseAbi,encodeFunctionData,decodeFunctionResult,keccak256,stringToHex }=require("viem");
assert.equal(process.argv.length,3,"Supply fresh .json.gz authority output path");
const output=resolve(process.argv[2]);assert.ok(!existsSync(output));
const root=fileURLToPath(new URL("../../../../",import.meta.url));
const load=p=>JSON.parse(readFileSync(resolve(root,p)));
const treasury=load("docs/evidence/mobile-signing/treasuries-mainnet.json");
const safeRegistry=load("docs/evidence/rmt-task044/safe-infrastructure-4663.json").registry.contracts["1.4.1"];
const abi=parseAbi([
 "function migrationTemplates(uint32) view returns(address,bytes32)",
 "function getOwners() view returns(address[])","function getThreshold() view returns(uint256)","function nonce() view returns(uint256)",
 "function masterCopy() view returns(address)","function VERSION() view returns(string)",
 "function getModulesPaginated(address,uint256) view returns(address[],address)","function getStorageAt(uint256,uint256) view returns(bytes)"]);
const sentinel="0x0000000000000000000000000000000000000001";
const norm=x=>typeof x==="number"||typeof x==="bigint"?String(x):Array.isArray(x)?x.map(norm):x&&typeof x==="object"?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,norm(v)])):typeof x==="string"&&x.startsWith("0x")?x.toLowerCase():x;
const sha=b=>createHash("sha256").update(b).digest("hex");
const peers={official:"https://rpc.mainnet.chain.robinhood.com",pocket:"https://robinhood.api.pocket.network"};
const directoryCalls=[...[["migrationTemplates",[3],abi]],...["pending","pendingRotation","nonce","signerSetEpoch","latestVersion","suspended"].map(fn=>[fn,[],ABI]),["factories",[1],ABI]];
const safeCalls=["masterCopy","VERSION","getOwners","getThreshold","nonce"].map(fn=>[fn,[]]);
safeCalls.push(["getModulesPaginated",[sentinel,1n]],["getStorageAt",[BigInt(keccak256(stringToHex("fallback_manager.handler.address"))),1n]],
 ["getStorageAt",[BigInt(keccak256(stringToHex("guard_manager.guard.address"))),1n]]);
const admitted=new Set(directoryCalls.map(([fn,args,contractAbi])=>DIRECTORY+":"+encodeFunctionData({abi:contractAbi,functionName:fn,args})));
for(const safe of treasury.safes)for(const [fn,args] of safeCalls)admitted.add(safe.safe.toLowerCase()+":"+encodeFunctionData({abi,functionName:fn,args}));
const pins=[...treasury.safes.map(s=>({id:s.role,address:s.safe.toLowerCase(),runtimeHash:s.configuration.runtimeKeccak256})),
 ...["safe_l2","safe_proxy_factory","compatibility_fallback_handler"].map(id=>({id,address:safeRegistry[id].address.toLowerCase(),runtimeHash:safeRegistry[id].registryRuntimeKeccak256}))];
const report={schemaVersion:1,scope:"TASK091_BOUNDED_READ_ONLY_MIGRATION_TEMPLATE_AND_SAFE_AUTHORITY",startedAt:new Date().toISOString(),status:"UNKNOWN",requests:[],providers:{},
 signing:false,broadcast:false,simulation:false,methods:["eth_chainId","eth_getBlockByNumber","eth_getCode","eth_call"],limits:{requests:128,responseBytes:256*1024,timeoutMs:10000,retries:0}};
const save=()=>writeFileSync(output,gzipSync(JSON.stringify(report,null,2)+"\n"));let id=0;
async function rpc(name,method,params=[]){
 assert.ok(report.methods.includes(method));assert.ok(report.requests.length<report.limits.requests);
 if(method==="eth_getCode")assert.ok(pins.some(p=>p.address===params[0]));
 if(method==="eth_call"){assert.deepEqual(Object.keys(params[0]).sort(),["data","to"]);assert.ok(admitted.has(params[0].to+":"+params[0].data));}
 const row={provider:name,request:{jsonrpc:"2.0",id:++id,method,params},requestedAt:new Date().toISOString()};report.requests.push(row);save();
 try{const res=await fetch(peers[name],{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(row.request),redirect:"error",credentials:"omit",signal:AbortSignal.timeout(10000)});row.httpStatus=res.status;
 const chunks=[];let size=0;for await(const c of res.body){size+=c.length;assert.ok(size<=report.limits.responseBytes);chunks.push(c);}const bytes=Buffer.concat(chunks);row.rawUtf8=bytes.toString("utf8");row.responseSha256=sha(bytes);assert.equal(res.status,200);
 const body=JSON.parse(row.rawUtf8);assert.equal(body.id,row.request.id);assert.equal(body.jsonrpc,"2.0");assert.ok(!body.error);assert.ok(Object.hasOwn(body,"result"));row.status="OBSERVED";return body.result;
 }catch(e){row.status="UNAVAILABLE";row.failure=String(e.message).slice(0,200);throw e;}finally{row.finishedAt=new Date().toISOString();save();}
}
async function call(name,to,fn,args,contractAbi,at){return norm(decodeFunctionResult({abi:contractAbi,functionName:fn,data:await rpc(name,"eth_call",[{to,data:encodeFunctionData({abi:contractAbi,functionName:fn,args})},at])}));}
const header=b=>({number:String(BigInt(b.number)),hash:b.hash.toLowerCase(),timestamp:String(BigInt(b.timestamp))});
try{
 const heads=await Promise.all(Object.keys(peers).map(async name=>{assert.equal(BigInt(await rpc(name,"eth_chainId")),4663n);return rpc(name,"eth_getBlockByNumber",["latest",false]);}));
 const height=heads.map(b=>BigInt(b.number)).reduce((a,b)=>a<b?a:b),tag="0x"+height.toString(16);
 const anchors=await Promise.all(Object.keys(peers).map(name=>rpc(name,"eth_getBlockByNumber",[tag,false])));assert.deepEqual(header(anchors[0]),header(anchors[1]));
 report.anchor={...header(anchors[0]),timestampUtc:new Date(Number(BigInt(anchors[0].timestamp))*1000).toISOString()};assert.ok(Math.abs(Date.now()-Number(BigInt(report.anchor.timestamp))*1000)<180000);
 await Promise.all(Object.keys(peers).map(async name=>{
  const point={directory:{},runtimePins:[],safes:[]};report.providers[name]=point;
  for(const [fn,args,contractAbi]of directoryCalls){point.directory[fn]=await call(name,DIRECTORY,fn,args,contractAbi,tag);assert.deepEqual(await call(name,DIRECTORY,fn,args,contractAbi,"pending"),point.directory[fn]);}
  assert.deepEqual(point.directory.migrationTemplates,[ZERO_ADDRESS,ZERO]);
  for(const pin of pins){const observedHash=keccak256(await rpc(name,"eth_getCode",[pin.address,tag]));assert.equal(observedHash,pin.runtimeHash);point.runtimePins.push({...pin,observedHash,matches:true});}
  for(const safe of treasury.safes){const row={role:safe.role,address:safe.safe.toLowerCase(),state:{}};
   for(const [fn,args]of safeCalls){const key=fn==="getStorageAt"?(args[0]===safeCalls[6][1][0]?"handler":"guard"):fn;
    row.state[key]=await call(name,row.address,fn,args,abi,tag);assert.deepEqual(await call(name,row.address,fn,args,abi,"pending"),row.state[key]);}
   const c=safe.configuration;assert.equal(row.state.masterCopy,c.singleton.toLowerCase());assert.equal(row.state.VERSION,c.version);assert.deepEqual(row.state.getOwners,norm(c.owners));assert.equal(row.state.getThreshold,"2");
   assert.equal(row.state.nonce,"0");assert.deepEqual(row.state.getModulesPaginated,[[],sentinel]);assert.equal(row.state.handler,c.handler.toLowerCase());assert.equal(row.state.guard,c.guard.toLowerCase());
   row.pendingMatchesCanonical=true;point.safes.push(row);
  }
  assert.equal((await rpc(name,"eth_getBlockByNumber",[tag,false])).hash.toLowerCase(),report.anchor.hash);point.canonicalRechecked=true;
 }));
 assert.deepEqual(report.providers.official,report.providers.pocket);report.twoProvidersAgree=true;report.canonicalAnchorRechecked=true;report.status="AUTHORITY_AND_SAFE_CONFIGURATION_MATCH";
 assert.ok(Date.now()-Number(BigInt(report.anchor.timestamp))*1000<=180000);
 report.directory=report.providers.official.directory;report.safes=report.providers.official.safes;
 report.migrationAvailability="V2_TO_V3_TEMPLATE_NOT_PUBLISHED; FUTURE_SEPARATELY_NOTICED_ACTION_REQUIRED_FOR_V3_MIGRATION, NOT_FACTORY_V1_CREATION";
 assert.equal(report.directory.pending[0],DIGEST);
}catch(error){report.status="UNKNOWN";report.failureCategory=String(error.message).slice(0,200);process.exitCode=1;}
report.finishedAt=new Date().toISOString();report.producerSha256=sha(readFileSync(fileURLToPath(import.meta.url)));save();
console.log(JSON.stringify({status:report.status,anchor:report.anchor,directory:report.directory,safes:report.safes,requests:report.requests.length,failure:report.failureCategory},null,2));
