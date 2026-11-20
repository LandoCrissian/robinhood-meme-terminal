import assert from "node:assert/strict";
import {mkdirSync,existsSync,writeFileSync,appendFileSync,unlinkSync} from "node:fs";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {randomBytes} from "node:crypto";
import {spawn,execFileSync} from "node:child_process";
import {createServer} from "node:http";
import {parseArgs} from "node:util";
import {setTimeout as delay} from "node:timers/promises";
import {chromium,webkit} from "playwright";
import {runSeaportAcquisitionFixture} from "./fixture-run.mjs";
import {createBrowserListingWatcher} from "./browser-watcher.mjs";
import {testConnectedNativeOrderAdmission,assertIndexedNativeOrderAdmissions} from "./task085-connected-admission.mjs";
import {testSeaportSafeAdministrationBrowser} from "./browser-safe-admin.mjs";
import {testSeaportAcquisitionBrowser} from "./browser-integration.mjs";
import {checkpointReached,traceFailureReached} from "./browser-checkpoint.mjs";
import {postgresRuntimeEnvironment} from "../reclaim-v2/postgres-runtime-env.mjs";
import {startSeaportAcquisitionIndexer} from "../../apps/indexer/dist/seaport-acquisition-worker.js";
import {initializeSeaportVaultStore} from "../../apps/indexer/dist/seaport-acquisition-store.js";
const repository=fileURLToPath(new URL("../../",import.meta.url)),require=createRequire(new URL("../../apps/indexer/package.json",import.meta.url)),{Client}=require("pg"),{createPublicClient,http}=require("viem");
const{values}=parseArgs({options:{browser:{type:"string",default:"chromium"},anvil:{type:"string"},solc:{type:"string"},lib:{type:"string"},"pg-bin":{type:"string"},output:{type:"string"},"fork-robinhood":{type:"boolean"}}});
assert.ok(["chromium","webkit"].includes(values.browser));assert.ok(values.anvil&&values.solc&&values["pg-bin"]&&values.output);const out=resolve(values.output);assert.ok(!existsSync(out));mkdirSync(out,{recursive:true});
const pgBin=resolve(values["pg-bin"]),pgExe=name=>join(pgBin,name+(process.platform==="win32"?".exe":"")),cluster=join(out,"postgres"),database="rmt_seaport_fixture_"+randomBytes(5).toString("hex"),user="rmt_seaport_operator",password=randomBytes(24).toString("hex"),readKey=randomBytes(32).toString("hex");
const baseEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(?:path|pathext|systemroot|systemdrive|windir|temp|tmp|localappdata|appdata|userprofile|username|homedrive|homepath|comspec|programfiles(?:\(x86\))?|programdata|number_of_processors|os|home|lang)$/i.test(k)));baseEnv.NEXT_TELEMETRY_DISABLED="1";
const pgEnv=postgresRuntimeEnvironment(baseEnv,pgBin,process.env);assert.match(execFileSync(pgExe("postgres"),["--version"],{encoding:"utf8",env:pgEnv,windowsHide:true}),/PostgreSQL\) 18\.6(?:\D|$)/);
async function port(){const s=createServer();await new Promise((done,fail)=>{s.once("error",fail);s.listen(0,"127.0.0.1",done);});const p=s.address().port;await new Promise(done=>s.close(done));return p;}
const pgPort=await port(),sitePort=await port(),indexPort=await port(),proxyPort=await port(),site=`http://127.0.0.1:${sitePort}`,indexer=`http://127.0.0.1:${indexPort}`,proxyUrl=`http://127.0.0.1:${proxyPort}`;
const connectionString=`postgresql://${user}:${password}@127.0.0.1:${pgPort}/${database}`;let pgStarted=false,db,worker,browser,next,proxy;
async function connectDb(){const client=new Client({connectionString,connectionTimeoutMillis:5000});await client.connect();return client;}
async function until(fn,label,ms=60000){const end=Date.now()+ms;for(;;){try{const result=await fn();if(result)return result;}catch{}assert.ok(Date.now()<end,label);await delay(200);}}
try{
 const pw=join(out,"postgres-password");writeFileSync(pw,password,{mode:0o600});try{execFileSync(pgExe("initdb"),["-D",cluster,"-U",user,"-A","scram-sha-256","--pwfile",pw,"--no-locale","--encoding=UTF8"],{env:pgEnv,windowsHide:true,stdio:"pipe"});}finally{unlinkSync(pw);}
 appendFileSync(join(cluster,"postgresql.conf"),"\nunix_socket_directories = ''\n");execFileSync(pgExe("pg_ctl"),["-D",cluster,"-l",join(out,"postgres.log"),"-o",`-h 127.0.0.1 -p ${pgPort}`,"-w","start"],{env:pgEnv,windowsHide:true,stdio:"ignore"});pgStarted=true;
 const admin=new Client({connectionString:connectionString.replace("/"+database,"/postgres")});await admin.connect();try{await admin.query(`CREATE DATABASE "${database}"`);}finally{await admin.end();}
 const result=await runSeaportAcquisitionFixture({anvil:resolve(values.anvil),solc:resolve(values.solc),lib:values.lib&&resolve(values.lib),output:join(out,"chain"),forkRobinhood:values["fork-robinhood"]===true,callback:async fixture=>{
  const manifest={...fixture.bindings,coreFactoryRuntimeHash:fixture.bindings.coreFactoryHash};writeFileSync(join(out,"manifest.json"),JSON.stringify(manifest));let traceHidden=false;const deniedTraces=new Set();
  proxy=createServer(async(req,res)=>{try{let body="";for await(const part of req){body+=part;if(body.length>262144)throw Error("bound");}const request=JSON.parse(body);assert.ok(["eth_chainId","eth_blockNumber","eth_getBlockByNumber","eth_getBlockByHash","eth_getCode","eth_getStorageAt","eth_getBalance","eth_call","eth_getTransactionCount","eth_getTransactionReceipt","eth_getTransactionByHash","eth_getLogs","eth_estimateGas","eth_gasPrice","eth_maxPriorityFeePerGas","eth_feeHistory","debug_traceTransaction"].includes(request.method));if(traceHidden&&request.method==="debug_traceTransaction"){deniedTraces.add(String(request.params?.[0]).toLowerCase());throw Error("synthetic trace outage");}const value=await fixture.rpc(request.method,request.params??[]);res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({jsonrpc:"2.0",id:request.id,result:value}));}catch{res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({jsonrpc:"2.0",id:1,error:{code:-32000,message:"Isolated read evidence pending"}}));}});await new Promise(done=>proxy.listen(proxyPort,"127.0.0.1",done));
  const rpc=createPublicClient({transport:http(proxyUrl,{retryCount:0,timeout:8000}),cacheTime:0}),nativeAdmission=await testConnectedNativeOrderAdmission({fixture,rpc,out});let listingWatcher;const verifiedCycle=async point=>{await listingWatcher?.verifiedCycle(point);};db=await connectDb();worker=await startSeaportAcquisitionIndexer({db,rpc,manifest,readKey,port:indexPort,verifiedCycle});
  listingWatcher=await createBrowserListingWatcher({fixture,manifest,rpc,getDb:()=>db,out});
  const second=await connectDb();try{await assert.rejects(initializeSeaportVaultStore(second,manifest),/persistence unavailable/);}finally{await second.end();}
  const retainWorkerDiagnostics=(expectedCheckpoint,expectedReceipt)=>writeFileSync(join(out,"worker-diagnostics.json"),JSON.stringify({schemaVersion:1,scope:"isolated-local31337",production:false,...worker.diagnostics(),expectedCheckpoint:String(expectedCheckpoint),...(expectedReceipt&&{expectedReceipt}),deniedTraceTransactions:[...deniedTraces]},null,2)+"\n");
  const sync=async({expectPending=false,receipt,stage="SETTLEMENT_PROOF"}={})=>{await fixture.rpc("anvil_mine",["0x2"]);const required=BigInt(await fixture.rpc("eth_blockNumber"))-2n;if(expectPending){assert.ok(receipt&&BigInt(receipt.blockNumber)<=required);await until(async()=>{try{await worker.sync();}catch{}finally{retainWorkerDiagnostics(required,receipt);}return traceFailureReached(worker.diagnostics(),required,receipt,stage)&&deniedTraces.has(receipt.transactionHash.toLowerCase());},"Intended confirmed transaction did not remain pending at its unavailable trace");return;}await until(async()=>{try{await worker.sync();}finally{retainWorkerDiagnostics(required);}return checkpointReached(worker.diagnostics(),required);},"V2 trace/index checkpoint did not reach the post-mine confirmed height");};
  await sync();await assertIndexedNativeOrderAdmissions({db,report:nativeAdmission,out,phase:"INITIAL_CANONICAL_INDEX"});
  const sameBlock=fixture.sameBlock;assert.ok(sameBlock,"Genuine same-block Seaport attribution fixture required");
  const indexedSameBlock=await db.query("SELECT transaction_hash,payload FROM rmt_seaport_v2_settlements WHERE transaction_hash=ANY($1::text[])",[[sameBlock.validTransactionHash,sameBlock.unrelatedTransactionHash,sameBlock.revertedTransactionHash].map(h=>h.toLowerCase())]);
  assert.equal(indexedSameBlock.rowCount,1);assert.equal(indexedSameBlock.rows[0].transaction_hash,sameBlock.validTransactionHash.toLowerCase());
  const attributed=indexedSameBlock.rows[0].payload;assert.equal(attributed.orderHash,sameBlock.orderHash);assert.equal(attributed.transactionIndex,1);assert.equal(attributed.payments.find(p=>p.recipient.toLowerCase()===sameBlock.feeRecipient.toLowerCase()).amount,sameBlock.feeAmount);assert.notEqual(sameBlock.feeAmount,sameBlock.blockFeeDelta);
  writeFileSync(join(out,"indexer-acceptance.json"),JSON.stringify({schemaVersion:1,status:"PASS",scope:"isolated-local31337",production:false,sameBlock:{...sameBlock,transactionIndex:attributed.transactionIndex,exactReceiptFee:sameBlock.feeAmount,unrelatedAndRevertedExcluded:true},singleWriterDenied:true},null,2)+"\n");
  const env={...baseEnv,RMT_SEAPORT_ACQUISITION_FIXTURE:"local-reviewed-seaport-acquisition-v2",RMT_SEAPORT_ACQUISITION_SITE:site,RMT_SEAPORT_ACQUISITION_RPC:proxyUrl,RMT_SEAPORT_ACQUISITION_INDEXER:indexer,RMT_SEAPORT_ACQUISITION_READ_KEY:readKey,RMT_SEAPORT_ACQUISITION_MANIFEST:join(out,"manifest.json")};
  assert.ok(existsSync(join(repository,"apps/launch-website/.next/BUILD_ID")),"Build the existing launch website before connected verification");
  const startNext=async()=>{
   next=spawn(process.execPath,[join(repository,"apps/launch-website/node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","-p",String(sitePort)],{cwd:join(repository,"apps/launch-website"),env,windowsHide:true,stdio:["ignore","pipe","pipe"]});let nextLog="";for(const pipe of[next.stdout,next.stderr])pipe.on("data",b=>{nextLog=(nextLog+b.toString()).slice(-20000);writeFileSync(join(out,"next.log"),nextLog);});
  await until(async()=>{const r=await fetch(site+"/api/seaport-acquisition");return r.status===200&&(await r.json()).status==="ready";},"Next local V2 evidence did not become ready",120000);
  };
  const restartNext=async()=>{if(next&&next.exitCode===null){const exited=new Promise(done=>next.once("exit",done));next.kill();await Promise.race([exited,delay(5000)]);assert.ok(next.exitCode!==null||next.signalCode!==null,"Next must stop before restarting");}await startNext();};
  await startNext();
  browser=await({chromium,webkit}[values.browser]).launch({headless:true});
  const restart=async()=>{await worker.close();await db.end();execFileSync(pgExe("pg_ctl"),["-D",cluster,"-w","-m","fast","stop"],{env:pgEnv,windowsHide:true,stdio:"ignore"});pgStarted=false;execFileSync(pgExe("pg_ctl"),["-D",cluster,"-l",join(out,"postgres.log"),"-o",`-h 127.0.0.1 -p ${pgPort}`,"-w","start"],{env:pgEnv,windowsHide:true,stdio:"ignore"});pgStarted=true;db=await connectDb();worker=await startSeaportAcquisitionIndexer({db,rpc,manifest,readKey,port:indexPort,verifiedCycle});await sync();await assertIndexedNativeOrderAdmissions({db,report:nativeAdmission,out,phase:"POSTGRES_SERVER_RESTART"});};
  const connected=await testSeaportAcquisitionBrowser({browserEngine:browser,site,fixture,out,sync,hideTrace:v=>{traceHidden=v;},restart});
  const safeAdministration=await testSeaportSafeAdministrationBrowser({browserEngine:browser,site,fixture,out,sync,restart,restartNext,listingWatcher,hideTrace:v=>{traceHidden=v;},readAdminRows:async()=>(await db.query("SELECT payload FROM rmt_seaport_v2_admin_events ORDER BY block_number")).rows.map(r=>r.payload)});assert.equal(safeAdministration.status,"PASS");
  const version=(await db.query("SHOW server_version")).rows[0].server_version;return{status:connected.status,postgresql:version,singleWriterDenied:true,privateTables:["rmt_seaport_v2_binding","rmt_seaport_v2_blocks","rmt_seaport_v2_settlements","rmt_seaport_v2_admin_events"],safeAdministration:safeAdministration.status,postgresServerRestart:true,nextServerRestart:true,listingWatcher:"PASS",nativeOrderAdmission:nativeAdmission.status,indexedNativeOrders:nativeAdmission.accepted.length,fixtureMode:values["fork-robinhood"]?"actual-pinned-4663-seaport-local31337-project-binding-stub":"source-derived-seaport-real-fixed-1b-core-local31337",browser:values.browser,production:false};
 }});assert.equal(result.status,"PASS");console.log(JSON.stringify({status:"PASS",browser:values.browser,output:out,production:false}));
}catch(error){
 const failure=String(error?.stack??error).replaceAll(password,"[redacted]").replaceAll(readKey,"[redacted]").slice(0,20000);writeFileSync(join(out,"failure.json"),JSON.stringify({status:"incomplete",scope:"isolated-local31337",production:false,failure},null,2)+"\n");throw error;
}finally{
 if(browser)await browser.close();if(next){next.kill();await Promise.race([new Promise(done=>next.once("exit",done)),delay(3000)]);}if(worker)await worker.close();if(db)await db.end();if(proxy)await new Promise(done=>proxy.close(done));if(pgStarted)execFileSync(pgExe("pg_ctl"),["-D",cluster,"-w","-m","fast","stop"],{env:pgEnv,windowsHide:true,stdio:"ignore"});
}
