import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { ABI, ACTION, actionTuple, DIRECTORY, FACTORY, SENDER, DIGEST, SCHEDULE, EXECUTE_DATA } from "./review-packet.mjs";
const require=createRequire(new URL("../../../../apps/launch-website/package.json",import.meta.url));
const { parseAbi,encodeFunctionData,decodeFunctionResult,decodeEventLog,keccak256,stringToHex }=require("viem");
const sha=b=>createHash("sha256").update(b).digest("hex");
const key=(method,params)=>JSON.stringify([method,params]).toLowerCase();
// Independent replay of saved public RPC bytes, not an assertion of their summary flags.
export function verifyCaptureEvidence(report,{protocol,profile,scheduled}) {
 assert.equal(report.scope,"TASK091_BOUNDED_PUBLIC_GOVERNANCE_RUNTIME_AND_UNSIGNED_EXECUTION_REVIEW");
 assert.equal(report.signing,false);assert.equal(report.broadcast,false);assert.equal(report.governanceExecution,false);assert.equal(report.tokenCreation,false);
 assert.equal(report.status,"PENDING_TIME_ELIGIBLE");assert.ok(report.requests.length<=220);
 assert.equal(report.compilerInputSha256,profile.inputSha256);assert.equal(report.sourcePlanSha256,protocol.planSha256);
 const permitted=new Set(["eth_chainId","eth_getBlockByNumber","eth_getCode","eth_call","eth_getTransactionReceipt","eth_getTransactionCount","eth_getBalance","eth_estimateGas","eth_maxPriorityFeePerGas","eth_gasPrice"]);
 const ids=new Set(),calls={official:new Map(),pocket:new Map()};
 for(const row of report.requests){
  assert.ok(Object.hasOwn(calls,row.provider));assert.ok(permitted.has(row.request.method),"PROHIBITED_RPC_METHOD");
  assert.equal(row.status,"OBSERVED");assert.equal(row.httpStatus,200);assert.equal(row.responseSha256,sha(Buffer.from(row.rawUtf8)),"RAW_RESPONSE_DIGEST");
  const response=JSON.parse(row.rawUtf8);assert.equal(response.jsonrpc,"2.0");assert.equal(response.id,row.request.id);assert.ok(!response.error);
  assert.ok(!ids.has(row.request.id));ids.add(row.request.id);
  const k=key(row.request.method,row.request.params),list=calls[row.provider].get(k)??[];list.push(response.result);calls[row.provider].set(k,list);
 }
 const get=(name,method,params)=>{const rows=calls[name].get(key(method,params));assert.ok(rows?.length,"REQUIRED_RAW_CALL_MISSING: "+method);return rows.at(-1);};
 const tag="0x"+BigInt(report.anchor.number).toString(16);
 const pins=[...protocol.constructors,...protocol.bootstrapChildren,...Object.values(profile.externalRuntimePins)];
 assert.equal(pins.length,14);
 for(const name of ["official","pocket"]){
  assert.equal(BigInt(get(name,"eth_chainId",[])),4663n);
  const blocks=calls[name].get(key("eth_getBlockByNumber",[tag,false]));assert.ok(blocks.length>=3);
  for(const b of blocks){assert.equal(String(BigInt(b.number)),report.anchor.number);assert.equal(b.hash,report.anchor.hash);assert.equal(String(BigInt(b.timestamp)),report.anchor.timestamp);}
  const rawPins=pins.map(pin=>({address:pin.address.toLowerCase(),hash:keccak256(get(name,"eth_getCode",[pin.address,tag]))}));
  for(const [i,pin]of pins.entries())assert.equal(rawPins[i].hash,pin.runtimeHash,"RAW_RUNTIME_DRIFT");
  for(const pin of report.providers[name].runtimes)assert.ok(rawPins.some(p=>p.address===pin.address&&p.hash===pin.observedHash&&p.hash===pin.runtimeHash));
  assert.equal(report.providers[name].runtimes.length,14);
  for(const proof of protocol.constructors){const r=get(name,"eth_getTransactionReceipt",[proof.transactionHash]);assert.equal(r.blockHash,proof.blockHash);assert.equal(BigInt(r.status),1n);assert.equal(r.contractAddress.toLowerCase(),proof.address.toLowerCase());
   assert.equal(get(name,"eth_getBlockByNumber",[r.blockNumber,false]).hash,proof.blockHash);}
  const receipt=get(name,"eth_getTransactionReceipt",[SCHEDULE]);assert.equal(receipt.blockHash,scheduled.blockHash);assert.equal(BigInt(receipt.status),1n);
  const events=receipt.logs.filter(l=>l.address.toLowerCase()===DIRECTORY).map(l=>decodeEventLog({abi:ABI,eventName:"ActionScheduled",topics:l.topics,data:l.data,strict:true}));
  assert.equal(events.length,1);assert.equal(events[0].args.digest,DIGEST);assert.equal(events[0].args.nonce,0n);assert.equal(BigInt(events[0].args.executableAt),1795131148n);assert.equal(BigInt(events[0].args.expiresAt),BigInt(ACTION.deadline));
  assert.equal(get(name,"eth_getBlockByNumber",[receipt.blockNumber,false]).hash,scheduled.blockHash);
  const functions=["pending","pendingRotation","nonce","signerSetEpoch","rotationNonce","suspended","latestVersion","currentFactory","signerA","signerB","signerC","publicationDelay","executionWindow"];
  for(const fn of functions){for(const at of [tag,"pending"]){const raw=get(name,"eth_call",[{to:DIRECTORY,data:encodeFunctionData({abi:ABI,functionName:fn})},at]);
    const normalized=JSON.parse(JSON.stringify(decodeFunctionResult({abi:ABI,functionName:fn,data:raw}),(_,v)=>typeof v==="bigint"||typeof v==="number"?String(v):typeof v==="string"&&v.startsWith("0x")?v.toLowerCase():v));
    assert.deepEqual(normalized,report.state[fn],"RAW_GOVERNANCE_STATE_DIFFERS");}}
  for(const [to,fn,args,expected]of [[DIRECTORY,"factories",[1],report.state.factories],[DIRECTORY,"actionDigest",[actionTuple()],DIGEST],[FACTORY,"engineVersion",[],"1"]])for(const at of [tag,"pending"]){
   const raw=get(name,"eth_call",[{to,data:encodeFunctionData({abi:ABI,functionName:fn,args})},at]);
   const normalized=JSON.parse(JSON.stringify(decodeFunctionResult({abi:ABI,functionName:fn,data:raw}),(_,v)=>typeof v==="bigint"||typeof v==="number"?String(v):typeof v==="string"&&v.startsWith("0x")?v.toLowerCase():v));
   assert.deepEqual(normalized,expected);
  }
  assert.deepEqual([report.state.signerA,report.state.signerB,report.state.signerC],["signerA","signerB","signerC"].map(k=>scheduled.currentDirectory[0].state[k].toLowerCase()));
  for(const key of ["signerA","signerB","signerC"])for(const at of [tag,"pending"])assert.equal(get(name,"eth_getCode",[report.state[key],at]),"0x");
  assert.equal(report.providers[name].bindings.length,21);
  for(const binding of report.providers[name].bindings){
   const raw=get(name,"eth_call",[{to:binding.address,data:encodeFunctionData({abi:ABI,functionName:binding.getter})},tag]);
   const actual=decodeFunctionResult({abi:ABI,functionName:binding.getter,data:raw});
   assert.equal(String(actual).toLowerCase(),String(binding.expected).toLowerCase());assert.equal(String(actual).toLowerCase(),String(binding.actual).toLowerCase());
  }
  assert.equal(String(BigInt(get(name,"eth_getTransactionCount",[SENDER,tag]))),report.account.confirmedNonce);
  assert.equal(String(BigInt(get(name,"eth_getTransactionCount",[SENDER,"pending"]))),report.account.pendingNonce);
  assert.equal(String(BigInt(get(name,"eth_getBalance",[SENDER,tag]))),report.account.balanceWei);
  for(const at of [tag,"pending"]){
   assert.equal(get(name,"eth_getCode",[SENDER,at]),"0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b");
   assert.equal(keccak256(get(name,"eth_getCode",["0x63c0c19a282a1b52b07dd5a65b58948a07dae32b",at])),"0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0");
  }
  assert.equal(get(name,"eth_call",[report.executionRequest,tag]),"0x");
  assert.equal(report.executionRequest.data,EXECUTE_DATA);assert.equal(report.executionRequest.to,DIRECTORY);assert.equal(report.executionRequest.from,SENDER);assert.equal(report.executionRequest.value,"0x0");
  assert.equal(String(BigInt(get(name,"eth_estimateGas",[report.executionRequest,tag]))),report.estimates.find(e=>e.name===name).estimate);
 }
 assert.equal(report.state.pending[0],DIGEST);
 assert.deepEqual(report.providers.official,report.providers.pocket);
 return {status:"RAW_EVIDENCE_REPLAYED",witnesses:2,runtimePins:14,requestCount:report.requests.length,signingAuthorized:false,broadcastAuthorized:false};
}

export function verifyAuthorityEvidence(report,{treasury,safeRegistry}) {
 assert.equal(report.scope,"TASK091_BOUNDED_READ_ONLY_MIGRATION_TEMPLATE_AND_SAFE_AUTHORITY");assert.equal(report.status,"AUTHORITY_AND_SAFE_CONFIGURATION_MATCH");
 assert.equal(report.signing,false);assert.equal(report.broadcast,false);assert.equal(report.simulation,false);assert.ok(report.requests.length<=128);
 const abi=parseAbi(["function migrationTemplates(uint32) view returns(address,bytes32)","function masterCopy() view returns(address)","function VERSION() view returns(string)",
  "function getOwners() view returns(address[])","function getThreshold() view returns(uint256)","function nonce() view returns(uint256)",
  "function getModulesPaginated(address,uint256) view returns(address[],address)","function getStorageAt(uint256,uint256) view returns(bytes)"]);
 const allowed=new Set(["eth_chainId","eth_getBlockByNumber","eth_getCode","eth_call"]),calls={official:new Map(),pocket:new Map()};
 for(const row of report.requests){assert.ok(allowed.has(row.request.method));assert.equal(row.status,"OBSERVED");assert.equal(row.httpStatus,200);assert.equal(sha(row.rawUtf8),row.responseSha256);
  const body=JSON.parse(row.rawUtf8);assert.equal(body.jsonrpc,"2.0");assert.equal(body.id,row.request.id);assert.ok(!body.error);
  if(row.request.method==="eth_call")assert.deepEqual(Object.keys(row.request.params[0]).sort(),["data","to"]);
  const k=key(row.request.method,row.request.params),list=calls[row.provider].get(k)??[];list.push(body.result);calls[row.provider].set(k,list);
 }
 const get=(name,method,params)=>{const rows=calls[name].get(key(method,params));assert.ok(rows?.length,"MISSING_AUTHORITY_RAW_CALL");return rows.at(-1);};
 const norm=x=>typeof x==="bigint"||typeof x==="number"?String(x):Array.isArray(x)?x.map(norm):typeof x==="string"&&x.startsWith("0x")?x.toLowerCase():x;
 const tag="0x"+BigInt(report.anchor.number).toString(16),sentinel="0x0000000000000000000000000000000000000001";
 const read=(name,to,fn,args,contractAbi,at)=>norm(decodeFunctionResult({abi:contractAbi,functionName:fn,data:get(name,"eth_call",[{to:to.toLowerCase(),data:encodeFunctionData({abi:contractAbi,functionName:fn,args})},at])}));
 for(const name of ["official","pocket"]){
  assert.equal(BigInt(get(name,"eth_chainId",[])),4663n);const blocks=calls[name].get(key("eth_getBlockByNumber",[tag,false]));assert.ok(blocks.length>=2);
  for(const b of blocks){assert.equal(b.hash,report.anchor.hash);assert.equal(String(BigInt(b.number)),report.anchor.number);assert.equal(String(BigInt(b.timestamp)),report.anchor.timestamp);}
  for(const at of [tag,"pending"]){
   assert.deepEqual(read(name,DIRECTORY,"migrationTemplates",[3],abi,at),["0x"+"0".repeat(40),"0x"+"0".repeat(64)]);
   for(const fn of ["pending","pendingRotation","nonce","signerSetEpoch","latestVersion","suspended"])assert.deepEqual(read(name,DIRECTORY,fn,[],ABI,at),report.directory[fn]);
   assert.deepEqual(read(name,DIRECTORY,"factories",[1],ABI,at),report.directory.factories);
  }
  for(const id of ["safe_l2","safe_proxy_factory","compatibility_fallback_handler"]){const p=safeRegistry[id];assert.equal(keccak256(get(name,"eth_getCode",[p.address.toLowerCase(),tag])),p.registryRuntimeKeccak256);}
  for(const safe of treasury.safes){
   const c=safe.configuration;assert.equal(keccak256(get(name,"eth_getCode",[safe.safe.toLowerCase(),tag])),c.runtimeKeccak256);
   const expected={masterCopy:c.singleton.toLowerCase(),VERSION:c.version,getOwners:norm(c.owners),getThreshold:"2",nonce:"0"};
   for(const at of [tag,"pending"]){
    for(const [fn,value]of Object.entries(expected))assert.deepEqual(read(name,safe.safe,fn,[],abi,at),value);
    assert.deepEqual(read(name,safe.safe,"getModulesPaginated",[sentinel,1n],abi,at),[[],sentinel]);
    assert.equal(read(name,safe.safe,"getStorageAt",[BigInt(keccak256(stringToHex("fallback_manager.handler.address"))),1n],abi,at),c.handler.toLowerCase());
    assert.equal(read(name,safe.safe,"getStorageAt",[BigInt(keccak256(stringToHex("guard_manager.guard.address"))),1n],abi,at),c.guard.toLowerCase());
   }
  }
 }
 assert.deepEqual(report.providers.official,report.providers.pocket);
 return {status:"RAW_AUTHORITY_EVIDENCE_REPLAYED",witnesses:2,safes:2,runtimePins:5,requestCount:report.requests.length,signingAuthorized:false,broadcastAuthorized:false};
}
