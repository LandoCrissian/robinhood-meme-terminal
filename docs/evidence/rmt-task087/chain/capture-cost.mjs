import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {parseArgs} from "node:util";
import {setTimeout as delay} from "node:timers/promises";
import {MOBILE_DELEGATE_POLICY} from "../../../../scripts/production-readiness/mobile-sender.mjs";
import {ROBINHOOD_SOURCES,MOBILE_DEPLOYMENT_PAYER} from "../../../../scripts/production-readiness/rpc.mjs";

const require=createRequire(new URL("../../../../apps/launch-website/package.json",import.meta.url));
const v=require("viem"),scheduled=JSON.parse(readFileSync(new URL("../../mobile-signing/factory-publication-scheduled.json",import.meta.url)));
const action={...scheduled.action,nonce:BigInt(scheduled.action.nonce),signerSetEpoch:BigInt(scheduled.action.signerSetEpoch),deadline:BigInt(scheduled.action.deadline)};
const abi=v.parseAbi(["function execute((uint8 kind,uint64 nonce,uint32 version,address factory,bytes32 runtimeHash,uint64 signerSetEpoch,uint48 deadline))",
 "function pending() view returns(bytes32,uint48,uint48)","function nonce() view returns(uint64)","function signerSetEpoch() view returns(uint64)","function suspended() view returns(bool)"]);
const gasAbi=v.parseAbi(["function gasEstimateComponents(address,bool,bytes) returns(uint64,uint64,uint256,uint256)"]);
const payer=MOBILE_DEPLOYMENT_PAYER,directory=scheduled.directory,node="0x00000000000000000000000000000000000000c8";
export const executeData=v.encodeFunctionData({abi,functionName:"execute",args:[action]});
const gasData=v.encodeFunctionData({abi:gasAbi,functionName:"gasEstimateComponents",args:[directory,false,executeData]});
const getters=["pending","nonce","signerSetEpoch","suspended"],getterData=new Set(getters.map(functionName=>v.encodeFunctionData({abi,functionName})));
const q=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i,same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
export const normalizeCostEvidence=x=>Array.isArray(x)?x.map(normalizeCostEvidence):typeof x==="bigint"||typeof x==="number"?String(x):x;
const normalized=normalizeCostEvidence;
function assertExpected(expected){
 assert.ok(expected&&q.test(expected.tag),"EXACT_COST_REQUEST_REQUIRED");const r=expected.request;
 assert.deepEqual(Object.keys(r).sort(),["chainId","data","from","nonce","to","type","value"]);
 assert.equal(r.type,"0x2");assert.equal(r.chainId,"0x1237");assert.equal(r.from,payer);assert.equal(r.to,directory);assert.equal(r.value,"0x0");assert.equal(r.data,executeData);assert.ok(q.test(r.nonce));
}
export function assertCostRead(method,params,expected){
 assert.ok(Array.isArray(params)&&Buffer.byteLength(JSON.stringify(params))<=8192,"READ_PARAMETER_BOUND");
 if(method==="eth_chainId"||method==="eth_gasPrice"||method==="eth_maxPriorityFeePerGas"){assert.deepEqual(params,[]);return;}
 if(method==="eth_getBlockByNumber"){assert.equal(params.length,2);assert.ok(params[0]==="latest"||q.test(params[0]));assert.equal(params[1],false);return;}
 if(method==="eth_getTransactionCount"||method==="eth_getBalance"||method==="eth_getCode"){
  assert.equal(params.length,2);assert.ok(q.test(params[1])||params[1]==="pending");
  assert.ok(same(params[0],payer)||method==="eth_getCode"&&same(params[0],MOBILE_DELEGATE_POLICY.address));return;
 }
 if(method==="eth_estimateGas"){assertExpected(expected);assert.deepEqual(params,[expected.request,expected.tag]);return;}
 if(method==="eth_call"){
  assert.equal(params.length,2);const[call,tag]=params;assert.ok(q.test(tag)||tag==="pending");
  if(same(call?.to,directory)&&getterData.has(call?.data)){assert.deepEqual(Object.keys(call).sort(),["data","to"]);return;}
  assertExpected(expected);assert.equal(tag,expected.tag);
  if(same(call?.to,directory)){assert.deepEqual(call,expected.request);return;}
  assert.deepEqual(call,{from:payer,to:node,value:"0x0",data:gasData});return;
 }
 throw Error("METHOD_OUTSIDE_READ_ONLY_COST_SCOPE");
}
function reader(name,budget,expected){
 assert.ok(["official","pocket"].includes(name));
 return async(method,params=[])=>{
  assertCostRead(method,params,expected);assert.ok(++budget.calls<=64,"READ_COUNT_BOUND");const id=budget.calls;
  budget.lastRead={method,blockTag:typeof params[1]==="string"?params[1]:null,target:typeof params[0]?.to==="string"?params[0].to:null,selector:typeof params[0]?.data==="string"?params[0].data.slice(0,10):null};
  if(name==="pocket"){await delay(Math.max(0,(budget.nextAllowedAt??0)-Date.now()));budget.nextAllowedAt=Date.now()+250;}
  const response=await fetch(ROBINHOOD_SOURCES[name],{method:"POST",redirect:"error",credentials:"omit",signal:AbortSignal.timeout(10000),headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id,method,params})});
  budget.lastHttpStatus=response.status;assert.equal(response.status,200,"RPC_HTTP_UNAVAILABLE");let size=0;const chunks=[];
  for await(const chunk of response.body){size+=chunk.length;assert.ok(size<=192*1024,"RPC_BODY_BOUND");chunks.push(chunk);}
  const body=JSON.parse(Buffer.concat(chunks));budget.lastRpc={identityMatches:body.jsonrpc==="2.0"&&body.id===id,errorCode:Number.isSafeInteger(body.error?.code)?body.error.code:null,resultUnavailable:body.result===null||body.result===undefined};assert.ok(body.jsonrpc==="2.0"&&body.id===id&&!body.error&&body.result!==null&&body.result!==undefined,"RPC_EVIDENCE_UNAVAILABLE");return body.result;
 };
}
export function remainingWindow(at,ready,expires){
 const time=BigInt(at),start=BigInt(ready),end=BigInt(expires);assert.ok(start<=end);
 return{timeEligible:time>=start&&time<=end,expired:time>end,secondsRemaining:time<=end?String(end-time):"0",expiryInclusive:true};
}
export async function captureExecutionCost(notice){
 const base={schemaVersion:1,scope:"READ_ONLY_EXACT_DIRECTORY_EXECUTION_SIMULATION_AND_INDICATIVE_COST_NOT_SIGNING_REQUEST",chainId:4663,operationDigest:scheduled.digest,
  from:payer,to:directory,valueWei:"0",executeCalldata:executeData,executeCalldataKeccak256:v.keccak256(executeData),signingAuthorized:false,broadcastAuthorized:false,productionActivationAuthorized:false,finality:"L1_UNVERIFIED",
  producerSha256:sha(readFileSync(new URL(import.meta.url),"utf8").replaceAll("\r\n","\n")),producerNormalization:"LF"};
 const budgets={official:{calls:0},pocket:{calls:0}};
 try{
  assert.equal(notice.status,"SCHEDULE_VERIFIED_SEPARATE_OWNER_APPROVAL_REQUIRED");assert.equal(notice.digest,scheduled.digest);assert.equal(notice.chainId,4663);
  assert.ok(Date.now()-Date.parse(notice.observedAt)>=0&&Date.now()-Date.parse(notice.observedAt)<=15*60*1000,"ORIGINAL_NOTICE_OBSERVATION_STALE");
  const names=["official","pocket"],reads=Object.fromEntries(names.map(name=>[name,reader(name,budgets[name])])),heads=await Promise.all(names.map(name=>reads[name]("eth_getBlockByNumber",["latest",false])));
  const height=heads.map(b=>BigInt(b.number)).reduce((a,b)=>a<b?a:b),tag=v.toHex(height);
  const settled=await Promise.allSettled(names.map(async name=>{
   const read=reads[name],block=await read("eth_getBlockByNumber",[tag,false]);assert.equal(await read("eth_chainId"),"0x1237");assert.equal(BigInt(block.number),height);assert.ok(/^0x[0-9a-f]{64}$/i.test(block.hash));
   assert.ok(Math.abs(Date.now()-Number(BigInt(block.timestamp))*1000)<=180000,"ANCHOR_STALE");
   const state={};for(const functionName of getters){const data=v.encodeFunctionData({abi,functionName}),raw=await read("eth_call",[{to:directory,data},tag]);assert.equal(await read("eth_call",[{to:directory,data},"pending"]),raw);state[functionName]=normalized(v.decodeFunctionResult({abi,functionName,data:raw}));}
   assert.deepEqual(state,notice.current.find(row=>row.provider===name).state?Object.fromEntries(getters.map(key=>[key,notice.current.find(row=>row.provider===name).state[key]])):null,"GOVERNANCE_STATE_CHANGED");
   const window=remainingWindow(BigInt(block.timestamp),state.pending[1],state.pending[2]);assert.equal(window.timeEligible,true);
   const nonce=await read("eth_getTransactionCount",[payer,tag]);assert.ok(q.test(nonce));assert.equal(await read("eth_getTransactionCount",[payer,"pending"]),nonce,"PAYER_HAS_PENDING_TRANSACTION");
   const designator=await read("eth_getCode",[payer,tag]),delegate=await read("eth_getCode",[MOBILE_DELEGATE_POLICY.address,tag]);assert.equal(designator.toLowerCase(),MOBILE_DELEGATE_POLICY.designator);assert.equal(await read("eth_getCode",[payer,"pending"]),designator);assert.equal(v.keccak256(delegate),MOBILE_DELEGATE_POLICY.runtimeHash);assert.equal(await read("eth_getCode",[MOBILE_DELEGATE_POLICY.address,"pending"]),delegate);
   const request={type:"0x2",chainId:"0x1237",from:payer,to:directory,value:"0x0",data:executeData,nonce},costRead=reader(name,budgets[name],{request,tag});
   assert.equal(await costRead("eth_call",[request,tag]),"0x","EXACT_EXECUTION_SIMULATION_FAILED");
   const estimate=await costRead("eth_estimateGas",[request,tag]),tip=await costRead("eth_maxPriorityFeePerGas"),price=await costRead("eth_gasPrice");assert.ok([estimate,tip,price].every(value=>q.test(value)));
   const raw=await costRead("eth_call",[{from:payer,to:node,value:"0x0",data:gasData},tag]),[total,l1,baseFee,l1BaseFee]=v.decodeFunctionResult({abi:gasAbi,functionName:"gasEstimateComponents",data:raw});assert.ok(total>0n&&l1<=total&&baseFee>0n);
   const balance=BigInt(await read("eth_getBalance",[payer,tag]));
   return{name,block:{number:String(height),hash:block.hash,timestamp:String(BigInt(block.timestamp))},state,window,nonce,delegation:{designator,delegate:MOBILE_DELEGATE_POLICY.address,runtimeHash:v.keccak256(delegate)},simulation:{status:"SUCCESS_EPHEMERAL_ETH_CALL_NO_TRANSACTION",result:"0x"},gas:{estimate:String(BigInt(estimate)),tip:String(BigInt(tip)),price:String(BigInt(price)),nitro:{total:String(total),l1:String(l1),baseFee:String(baseFee),l1BaseFee:String(l1BaseFee)}},balance};
  }));
  for(const result of settled)if(result.status==="rejected")throw result.reason;
  const rows=settled.map(result=>result.value);
  assert.deepEqual(rows[0].block,rows[1].block);assert.deepEqual(rows[0].state,rows[1].state);assert.equal(rows[0].nonce,rows[1].nonce);
  const maximum=(...values)=>values.reduce((a,b)=>a>b?a:b),estimate=maximum(...rows.flatMap(row=>[BigInt(row.gas.estimate),BigInt(row.gas.nitro.total)])),gasLimit=(estimate*5n+3n)/4n,tip=maximum(...rows.map(row=>BigInt(row.gas.tip))),maxFee=maximum(...rows.flatMap(row=>[BigInt(row.gas.price),2n*BigInt(row.gas.nitro.baseFee)+tip]));
  for(const row of rows){assert.ok(row.balance>=gasLimit*maxFee);assert.equal((await reads[row.name]("eth_getBlockByNumber",[tag,false])).hash,row.block.hash,"ANCHOR_REORGED");assert.equal(await reads[row.name]("eth_getTransactionCount",[payer,"pending"]),row.nonce);assert.equal((await reads[row.name]("eth_getBlockByNumber",[v.toHex(BigInt(notice.current[0].block.number)),false])).hash,notice.current[0].block.hash);}
  return{...base,status:"EXACT_READ_ONLY_SIMULATION_AND_COST_OBSERVED",observedAt:new Date().toISOString(),observationBlock:rows[0].block,payerNonce:String(BigInt(rows[0].nonce)),readCounts:budgets,
   observations:rows.map(({balance,...row})=>({...row,balanceSufficient:true})),cost:{gasLimit:String(gasLimit),maxFeePerGasWei:String(maxFee),priorityFeeWei:String(tip),maximumIndicativeWei:String(gasLimit*maxFee),maximumIndicativeEth:v.formatEther(gasLimit*maxFee),
    estimatedExecutionAndPosting:rows.map(row=>({provider:row.name,totalWei:String(BigInt(row.gas.nitro.total)*BigInt(row.gas.nitro.baseFee)),l1PostingWei:String(BigInt(row.gas.nitro.l1)*BigInt(row.gas.nitro.baseFee))})),
    policy:"INDICATIVE_ONLY_NOT_OWNER_APPROVAL; Nitro total includes L1 component; 25% gas buffer and max observed fee policy; refresh nonce/state/cost in owner wallet before any separately approved transaction"}};
 }catch(error){return{...base,status:"EVIDENCE_UNAVAILABLE_NO_SIGNING_REQUEST",observedAt:new Date().toISOString(),readCounts:budgets,reason:error?.code??error?.name??"UNVERIFIED_COST_EVIDENCE"};}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){const{values}=parseArgs({options:{notice:{type:"string"},output:{type:"string"}}});assert.ok(values.notice&&values.output);const report=await captureExecutionCost(JSON.parse(readFileSync(values.notice,"utf8")));writeFileSync(resolve(values.output),JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});console.log(report.status+"; no signing or broadcast");if(report.status!=="EXACT_READ_ONLY_SIMULATION_AND_COST_OBSERVED")process.exitCode=1;}
