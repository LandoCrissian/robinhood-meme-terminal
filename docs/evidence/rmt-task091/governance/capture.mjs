import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { ABI, ACTION, actionTuple, DIRECTORY, FACTORY, FACTORY_HASH, SENDER, DIGEST, SCHEDULE,
  ZERO, ZERO_ADDRESS, EXECUTE_DATA, publicationDigest, validateReviewPacket } from "./review-packet.mjs";
const require = createRequire(new URL("../../../../apps/launch-website/package.json", import.meta.url));
const { parseAbi, encodeFunctionData, decodeFunctionResult, decodeEventLog, keccak256 } = require("viem");
assert.equal(process.argv.length, 3, "Supply a fresh evidence output directory (no wallet or private input).");
const output = resolve(process.argv[2]), repository = fileURLToPath(new URL("../../../../", import.meta.url));
assert.ok(existsSync(output));
const rawPath = resolve(output, "capture.json.gz"), packetPath = resolve(output, "unsigned-execute-review.json");
assert.ok(!existsSync(rawPath) && !existsSync(packetPath), "Never overwrite an observation");
const json = p => JSON.parse(readFileSync(resolve(repository, p)));
const protocol = json("docs/evidence/mobile-signing/protocol-mainnet.json");
const scheduled = json("docs/evidence/mobile-signing/factory-publication-scheduled.json");
const profile = json("docs/evidence/fixed-supply-security/4663-profile.json");
const sha = b => createHash("sha256").update(b).digest("hex");
const normalize = x => typeof x === "bigint" || typeof x === "number" ? String(x) : Array.isArray(x) ? x.map(normalize) :
  x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k,v]) => [k,normalize(v)])) : typeof x === "string" && x.startsWith("0x") ? x.toLowerCase() : x;
const equal = (a,b) => assert.deepEqual(normalize(a), normalize(b));
assert.equal(publicationDigest(), DIGEST); equal(scheduled.action, ACTION);
assert.equal(scheduled.transaction.from.toLowerCase(), SENDER); assert.equal(scheduled.digest, DIGEST);
const urls = { official: "https://rpc.mainnet.chain.robinhood.com", pocket: "https://robinhood.api.pocket.network" };
const pins = [...protocol.constructors, ...protocol.bootstrapChildren, ...Object.entries(profile.externalRuntimePins).map(([id,p]) => ({ id,...p }))]
  .map(p => ({ id: p.id ?? p.contract, address: p.address.toLowerCase(), runtimeHash: p.runtimeHash.toLowerCase() }));
assert.equal(new Set(pins.map(p => p.address)).size, pins.length);
const byAddress = Object.fromEntries(pins.map(p => [p.address,p]));
const governanceSigners = ["signerA","signerB","signerC"].map(k => scheduled.currentDirectory[0].state[k].toLowerCase());
const delegate = { address: "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b", runtimeHash: "0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0",
  designator: "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b" };
const engine = protocol.bootstrapChildren.find(p => p.contract === "RMTV4CurveGraduationV1").address.toLowerCase();
const guard = protocol.bootstrapChildren.find(p => p.contract === "RMTV4CurveInitializationGuardV1").address.toLowerCase();
const registry = protocol.constructors.find(p => p.id === "registry").address.toLowerCase();
const successor = protocol.constructors.find(p => p.id === "successor-v2").address.toLowerCase();
const external = profile.externalRuntimePins;
const getters = ["pending","pendingRotation","nonce","signerSetEpoch","rotationNonce","suspended","latestVersion","currentFactory",
  "signerA","signerB","signerC","publicationDelay","executionWindow"].map(fn => [DIRECTORY,fn,[]]);
getters.push([DIRECTORY,"factories",[1]], [DIRECTORY,"actionDigest",[actionTuple()]], [FACTORY,"engineVersion",[]]);
const bindings = [
  [registry,"directory",DIRECTORY], [FACTORY,"projectRegistry",registry], [FACTORY,"graduationEngine",engine],
  [FACTORY,"successorDeployer",successor], [FACTORY,"successorDeployerRuntimeHash",byAddress[successor].runtimeHash],
  [FACTORY,"operatingRecipient","0xaf9f10258b091719618c19d057f9cdab72effd8b"],
  [FACTORY,"futureReserveRecipient","0x8d44078642ce938fd799b23087bcdd6114a302e5"],
  [engine,"factory",FACTORY], [engine,"initializationGuard",guard], [engine,"poolManager",external.poolManager.address],
  [engine,"positionManager",external.positionManager.address], [engine,"permit2",external.permit2.address],
  [guard,"graduationEngine",engine], [guard,"poolManager",external.poolManager.address],
  [external.positionManager.address,"poolManager",external.poolManager.address], [external.positionManager.address,"permit2",external.permit2.address],
  [FACTORY,"creationFeeWei",profile.terms.creationFeeWei], [FACTORY,"tokenSupply",profile.terms.fixedSupplyWei],
  [engine,"CHAIN_ID","4663"], [engine,"POOL_FEE","3000"], [engine,"TICK_SPACING","60"],
];
const permittedGetters = new Set([...getters,...bindings.map(([to,fn]) => [to,fn,[]])].map(([to,fn,args]) =>
  to.toLowerCase() + ":" + encodeFunctionData({ abi: ABI, functionName: fn, args })));
const allowedCode = new Set([...pins.map(p => p.address), ...governanceSigners, SENDER, delegate.address]);
const nitroAbi = parseAbi(["function gasEstimateComponents(address,bool,bytes) payable returns(uint64,uint64,uint256,uint256)"]);
const nitroAddress = "0x00000000000000000000000000000000000000c8";
const nitroData = encodeFunctionData({ abi: nitroAbi, functionName: "gasEstimateComponents", args: [DIRECTORY,false,EXECUTE_DATA] });
let executionRequest, id = 0;
const report = { schemaVersion: 1, scope: "TASK091_BOUNDED_PUBLIC_GOVERNANCE_RUNTIME_AND_UNSIGNED_EXECUTION_REVIEW", startedAt: new Date().toISOString(),
  sourceCommit: execFileSync("git",["rev-parse","HEAD"],{cwd:repository,encoding:"utf8"}).trim(),
  sourcePlanSha256: protocol.planSha256, compilerInputSha256: protocol.compiler.inputSha256, providers: {}, requests: [], status: "UNKNOWN",
  signing: false, broadcast: false, governanceExecution: false, tokenCreation: false,
  stateChangingSimulation: "EXACT_ALREADY_SCHEDULED_PUBLICATION_ETH_CALL_AND_GAS_ESTIMATE_ONLY; EPHEMERAL_NOT_BROADCAST",
  limits: { totalRequests: 220, responseBytes: 256*1024, timeoutMs: 10000, retries: 0 }, expectedPins: pins,
  permittedMethods: ["eth_chainId","eth_getBlockByNumber","eth_getCode","eth_call","eth_getTransactionReceipt","eth_getTransactionCount","eth_getBalance","eth_estimateGas","eth_maxPriorityFeePerGas","eth_gasPrice"],
  limitations: ["L2 witness agreement does not establish independent Ethereum L1 finality.","Saved costs and nonce are indicative only; this packet expires for execution review after 180 seconds and requires fresh capture plus owner wallet approval.","Factory publication makes direct public creation possible even while website financial flags remain OFF.","Original signatures and Schedule are not repeated; no private credentials or wallet interface are used."] };
const save = () => writeFileSync(rawPath,gzipSync(JSON.stringify(report,null,2)+"\n"));
async function rpc(name,method,params=[]) {
  assert.ok(report.permittedMethods.includes(method), "METHOD_REFUSED");
  if (method === "eth_call") {
    const [call,tag] = params; assert.ok(/^0x[0-9a-f]+$/.test(tag) || tag === "pending");
    if (call.to === nitroAddress) equal(call,{from:SENDER,to:nitroAddress,value:"0x0",data:nitroData});
    else if (executionRequest && call.data === EXECUTE_DATA) equal(call,executionRequest);
    else { assert.deepEqual(Object.keys(call).sort(),["data","to"]); assert.ok(permittedGetters.has(call.to.toLowerCase()+":"+call.data),"GETTER_REFUSED"); }
  }
  if (method === "eth_estimateGas") { assert.ok(executionRequest); equal(params,[executionRequest,report.tag]); }
  if (method === "eth_getCode") assert.ok(allowedCode.has(params[0].toLowerCase()));
  if (["eth_getTransactionCount","eth_getBalance"].includes(method)) assert.equal(params[0],SENDER);
  if (method === "eth_getTransactionReceipt") assert.ok([SCHEDULE,...protocol.constructors.map(p=>p.transactionHash)].includes(params[0]));
  assert.ok(report.requests.length < report.limits.totalRequests,"REQUEST_BUDGET_EXHAUSTED");
  const row = { provider:name,requestedAt:new Date().toISOString(),request:{jsonrpc:"2.0",id:++id,method,params} }; report.requests.push(row); save();
  try {
    const r = await fetch(urls[name],{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(row.request),credentials:"omit",redirect:"error",signal:AbortSignal.timeout(10000)});
    row.httpStatus=r.status; const chunks=[]; let length=0;
    for await (const chunk of r.body) { length+=chunk.length; assert.ok(length<=report.limits.responseBytes,"RESPONSE_BOUND"); chunks.push(chunk); }
    const bytes=Buffer.concat(chunks); row.responseSha256=sha(bytes); row.rawUtf8=bytes.toString("utf8"); assert.equal(r.status,200);
    const body=JSON.parse(row.rawUtf8); assert.equal(body.id,row.request.id); assert.equal(body.jsonrpc,"2.0"); assert.ok(!body.error,JSON.stringify(body.error)); assert.ok(Object.hasOwn(body,"result"));
    row.status="OBSERVED"; return body.result;
  } catch(error) { row.status="UNAVAILABLE"; row.failure=String(error.message).slice(0,200); throw error; }
  finally { row.finishedAt=new Date().toISOString(); save(); }
}
async function call(name,to,fn,args=[],tag=report.tag) {
  return normalize(decodeFunctionResult({abi:ABI,functionName:fn,data:await rpc(name,"eth_call",[{to:to.toLowerCase(),data:encodeFunctionData({abi:ABI,functionName:fn,args})},tag])}));
}
const header = b => ({number:String(BigInt(b.number)),hash:b.hash.toLowerCase(),timestamp:String(BigInt(b.timestamp))});
try {
  const heads = await Promise.all(Object.keys(urls).map(async name => { assert.equal(BigInt(await rpc(name,"eth_chainId")),4663n); return rpc(name,"eth_getBlockByNumber",["latest",false]); }));
  const height = heads.map(b=>BigInt(b.number)).reduce((a,b)=>a<b?a:b); report.tag="0x"+height.toString(16);
  const anchors = await Promise.all(Object.keys(urls).map(name=>rpc(name,"eth_getBlockByNumber",[report.tag,false]))); equal(header(anchors[0]),header(anchors[1]));
  report.anchor={...header(anchors[0]),timestampUtc:new Date(Number(BigInt(anchors[0].timestamp))*1000).toISOString()};
  assert.ok(Math.abs(Date.now()-Number(BigInt(report.anchor.timestamp))*1000)<180000,"STALE_ANCHOR");
  await Promise.all(Object.keys(urls).map(async name => {
    const point={runtimes:[],governance:{},bindings:[],receipts:[],account:{}}; report.providers[name]=point;
    const schedule = await rpc(name,"eth_getTransactionReceipt",[SCHEDULE]); assert.ok(schedule); assert.equal(BigInt(schedule.status),1n);
    assert.equal(schedule.blockHash.toLowerCase(),scheduled.blockHash); assert.equal(String(BigInt(schedule.blockNumber)),scheduled.receiptBlock); assert.equal(schedule.to.toLowerCase(),DIRECTORY);
    const scheduleBlock=await rpc(name,"eth_getBlockByNumber",[schedule.blockNumber,false]); assert.equal(scheduleBlock.hash.toLowerCase(),scheduled.blockHash);
    const events=schedule.logs.filter(l=>l.address.toLowerCase()===DIRECTORY).map(l=>decodeEventLog({abi:ABI,eventName:"ActionScheduled",topics:l.topics,data:l.data,strict:true})); assert.equal(events.length,1);
    equal(events[0].args,{digest:DIGEST,nonce:0n,executableAt:1795131148n,expiresAt:1795722606n}); assert.equal(BigInt(scheduleBlock.timestamp)+172800n,1795131148n);
    point.schedule={transactionHash:SCHEDULE,blockHash:scheduled.blockHash,blockNumber:scheduled.receiptBlock,event:normalize(events[0].args)};
    for (const pin of pins) {
      const code=await rpc(name,"eth_getCode",[pin.address,report.tag]), observedHash=keccak256(code); assert.equal(observedHash,pin.runtimeHash,"RUNTIME_DRIFT_"+pin.id);
      point.runtimes.push({...pin,observedHash,codeBytes:(code.length-2)/2,matches:true});
    }
    for (const p of protocol.constructors) {
      const r=await rpc(name,"eth_getTransactionReceipt",[p.transactionHash]); assert.ok(r); assert.equal(BigInt(r.status),1n); assert.equal(r.blockHash.toLowerCase(),p.blockHash);
      assert.equal(r.contractAddress.toLowerCase(),p.address.toLowerCase()); assert.equal(String(BigInt(r.blockNumber)),p.blockNumber);
      const b=await rpc(name,"eth_getBlockByNumber",[r.blockNumber,false]); assert.equal(b.hash.toLowerCase(),p.blockHash);
      point.receipts.push({transactionHash:p.transactionHash,blockHash:p.blockHash,blockNumber:p.blockNumber,address:p.address.toLowerCase(),canonical:true});
    }
    for (const [to,fn,args] of getters) point.governance[fn === "engineVersion"?"factoryEngineVersion":fn]=await call(name,to,fn,args);
    for (const [to,fn,expected] of bindings) { const actual=await call(name,to,fn); equal(actual,expected); point.bindings.push({address:to.toLowerCase(),getter:fn,expected:normalize(expected),actual,matches:true}); }
    for (const a of governanceSigners) { assert.equal(await rpc(name,"eth_getCode",[a,report.tag]),"0x"); assert.equal(await rpc(name,"eth_getCode",[a,"pending"]),"0x"); }
    for (const at of [report.tag,"pending"]) {
      assert.equal(await rpc(name,"eth_getCode",[SENDER,at]),delegate.designator,"SENDER_DELEGATION_DRIFT");
      assert.equal(keccak256(await rpc(name,"eth_getCode",[delegate.address,at])),delegate.runtimeHash,"DELEGATE_RUNTIME_DRIFT");
    }
    point.account={from:SENDER,kind:"PINNED_EIP7702_DELEGATED_EOA",delegate,
      confirmedNonce:String(BigInt(await rpc(name,"eth_getTransactionCount",[SENDER,report.tag]))),
      pendingNonce:String(BigInt(await rpc(name,"eth_getTransactionCount",[SENDER,"pending"]))),
      balanceWei:String(BigInt(await rpc(name,"eth_getBalance",[SENDER,report.tag])))};
    assert.equal(point.account.confirmedNonce,point.account.pendingNonce,"PENDING_SENDER_TRANSACTION");
    assert.equal((await rpc(name,"eth_getBlockByNumber",[report.tag,false])).hash.toLowerCase(),report.anchor.hash); point.canonicalRechecked=true;
  }));
  equal(report.providers.official,report.providers.pocket); report.twoProvidersAgree=true; report.canonicalAnchorRechecked=true;
  report.allRuntimePinsMatch=true; report.state=report.providers.official.governance; report.account=report.providers.official.account;
  const state=report.state, now=BigInt(report.anchor.timestamp);
  if (state.factories[0]===FACTORY && state.factories[1]===FACTORY_HASH) {
    assert.equal(state.latestVersion,"1"); report.status="FACTORY_PUBLICATION_MAPPING_OBSERVED_NO_DUPLICATE_PACKET";
  } else if (state.pending[0]===DIGEST && state.nonce==="0" && state.signerSetEpoch==="1" && now>=1795131148n && now<=1795722606n) {
    report.status="PENDING_TIME_ELIGIBLE"; assert.deepEqual(state.factories,[ZERO_ADDRESS,ZERO]); assert.equal(state.latestVersion,"0"); assert.equal(state.suspended,false);
    assert.deepEqual(state.pendingRotation,[ZERO,"0","0"]); assert.equal(state.actionDigest,DIGEST); assert.equal(state.factoryEngineVersion,"1");
    assert.equal(state.publicationDelay,"172800"); assert.equal(state.executionWindow,"604800"); equal([state.signerA,state.signerB,state.signerC],governanceSigners);
    executionRequest={type:"0x2",chainId:"0x1237",from:SENDER,to:DIRECTORY,value:"0x0",data:EXECUTE_DATA,nonce:"0x"+BigInt(report.account.confirmedNonce).toString(16)};
    report.executionRequest=executionRequest;
    const estimates=await Promise.all(Object.keys(urls).map(async name=>{
      // Review simulation cannot pass this point unless the original real notice is mature.
      assert.equal(await rpc(name,"eth_call",[executionRequest,report.tag]),"0x");
      const estimate=BigInt(await rpc(name,"eth_estimateGas",[executionRequest,report.tag]));
      const tip=BigInt(await rpc(name,"eth_maxPriorityFeePerGas")),price=BigInt(await rpc(name,"eth_gasPrice"));
      const raw=await rpc(name,"eth_call",[{from:SENDER,to:nitroAddress,value:"0x0",data:nitroData},report.tag]);
      const [total,l1,baseFee,l1BaseFee]=decodeFunctionResult({abi:nitroAbi,functionName:"gasEstimateComponents",data:raw});
      assert.ok(estimate>0n && total>0n && l1<=total && baseFee>0n);
      return {name,estimate,total,l1,baseFee,l1BaseFee,tip,price};
    }));
    report.estimates=normalize(estimates);
    const max=(values)=>values.reduce((a,b)=>a>b?a:b),tip=max(estimates.map(e=>e.tip));
    const estimate=max(estimates.flatMap(e=>[e.estimate,e.total])),gas=(estimate*5n+3n)/4n;
    const maxFee=max(estimates.flatMap(e=>[e.price,2n*e.baseFee+tip]));
    assert.ok(anchors.every(b=>gas<=BigInt(b.gasLimit))); assert.ok(gas*maxFee<=BigInt(report.account.balanceWei));
    // Pending authority and sender nonce must remain unchanged after the simulation.
    await Promise.all(Object.keys(urls).map(async name=>{
      for (const [to,fn,args] of getters) equal(await call(name,to,fn,args,"pending"),state[fn==="engineVersion"?"factoryEngineVersion":fn]);
      assert.equal(String(BigInt(await rpc(name,"eth_getTransactionCount",[SENDER,"pending"]))),report.account.confirmedNonce);
      assert.equal((await rpc(name,"eth_getBlockByNumber",[report.tag,false])).hash.toLowerCase(),report.anchor.hash);
    }));
    const packet={schemaVersion:1,scope:"TASK091_REVIEW_ONLY_UNSIGNED_FACTORY_PUBLICATION",action:ACTION,actionDigest:DIGEST,
      signingAuthorized:false,broadcastAuthorized:false,chainId:4663,from:SENDER,to:DIRECTORY,valueWei:"0",accountNonce:report.account.confirmedNonce,
      data:EXECUTE_DATA,dataHash:keccak256(EXECUTE_DATA),calldataBytes:(EXECUTE_DATA.length-2)/2,request:executionRequest,
      anchor:report.anchor,observedAt:new Date().toISOString(),schedule:{transactionHash:SCHEDULE,blockHash:scheduled.blockHash,blockNumber:scheduled.receiptBlock},
      deadlineUtc:"2026-11-26T19:50:06.000Z",deadlineDenver:"2026-11-26 12:50:06 MST",deadlineInclusive:true,
      reviewRefreshRequiredAfterUtc:new Date((Number(BigInt(report.anchor.timestamp))+180)*1000).toISOString(),
      cost:{gasEstimate:estimate.toString(),gasLimit:gas.toString(),maxFeePerGasWei:maxFee.toString(),priorityFeeWei:tip.toString(),
        maximumWei:(gas*maxFee).toString(),estimatedWei:max(estimates.map(e=>e.total*e.baseFee)).toString(),
        l1PostingEstimateWei:max(estimates.map(e=>e.l1*e.baseFee)).toString(),policy:"INDICATIVE_ONLY_RECAPTURE_AND_OWNER_WALLET_CURRENT_COST_APPROVAL_REQUIRED"},
      expectedEffect:{latestVersion:"1",factoryMapping:[FACTORY,FACTORY_HASH],pending:[ZERO,"0","0"],actionNonce:"1",assetMovement:false,tokenCreation:false},
      risk:"Permissionless execution publishes the factory, permitting direct public token creation immediately even while the website remains read-only. This does not publish the V3 migration template or enable website transactions.",
      followup:"Do not repeat Schedule/signatures. Recheck current pending/action/nonce/epoch/runtime/canonicality/delegation/fees immediately before any owner-controlled signing. If mapping already published, recover and verify its canonical event; never submit a duplicate.",
      finality:"L1_UNVERIFIED",strictScanner:"FAIL_HIGH_22_AND_GOVERNANCE_MEDIUM_7_RETAINED",captureFile:"capture.json.gz"};
    packet.offlineAdmission=validateReviewPacket(packet,report,BigInt(Math.floor(Date.now()/1000)));
    writeFileSync(packetPath,JSON.stringify(packet,null,2)+"\n",{flag:"wx"}); report.reviewPacketSha256=sha(readFileSync(packetPath));
    report.reviewPrepared=true;
  } else { report.status=now>1795722606n?"EXPIRED_OR_CHANGED_DO_NOT_EXECUTE":"CHANGED_STATE_REQUIRES_RECONCILIATION"; }
} catch(error) { report.status="UNKNOWN"; report.failureCategory=String(error.message).slice(0,240); process.exitCode=1; }
report.finishedAt=new Date().toISOString(); report.producerSha256=sha(readFileSync(fileURLToPath(import.meta.url))); save();
console.log(JSON.stringify({status:report.status,anchor:report.anchor,requestCount:report.requests.length,runtimeCount:report.expectedPins.length,
  state:report.state,account:report.account&&{from:report.account.from,kind:report.account.kind,nonce:report.account.confirmedNonce},reviewPrepared:report.reviewPrepared,
  failureCategory:report.failureCategory,output},null,2));
