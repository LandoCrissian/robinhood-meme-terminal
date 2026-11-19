import {createServer} from "node:http";
import {timingSafeEqual} from "node:crypto";
import type {Client} from "pg";
import {parseEventLogs,type PublicClient,type Hash} from "viem";
import {verifySeaportVaultRuntime,verifySeaportVaultReceipt,seaportVaultAbi} from "./seaport-acquisition-evidence.js";
import {initializeSeaportVaultStore,commitSeaportVaultBlock,rollbackSeaportVaultStore,readSeaportVaultStore} from "./seaport-acquisition-store.js";
import type {SeaportVaultManifest,SeaportVaultSettlement} from "./seaport-acquisition-types.js";
const json=(v:unknown)=>JSON.stringify(v,(_,x)=>typeof x==="bigint"?x.toString():x);
/** Background polls and explicit synchronization must await the same canonical
 * verification. Returning early during a poll can starve readiness observers. */
export function shareSeaportVerification(work:()=>Promise<void>){
  let pending:Promise<void>|undefined;
  return{run(){if(!pending)pending=Promise.resolve().then(work).finally(()=>{pending=undefined;});return pending;},current:()=>pending};
}
/** Private sidecar, explicitly constructed by the synthetic fixture harness.
 * No environment discovery, production startup or migration is registered. */
export async function startSeaportAcquisitionIndexer({db,rpc,manifest:m,readKey,port}:{db:Client;rpc:PublicClient;manifest:SeaportVaultManifest;readKey:string;port:number}){
  if(!/^[a-f0-9]{64}$/.test(readKey)||/^0+$/.test(readKey)||!Number.isSafeInteger(port)||port<1024||port>65535)throw Error("Seaport V2 fixture binding required");
  await initializeSeaportVaultStore(db,m);await verifySeaportVaultRuntime(rpc,m);
  let status:"ready"|"pending"="pending",closed=false,attempts=0,successfulCycles=0,stage="NOT_STARTED",targetHeight:string|undefined,checkpointHeight:string|undefined,verifyingBlock:string|undefined,verifyingTransaction:string|undefined;
  let lastFailure:{stage:string;message:string;blockNumber?:string;transactionHash?:string}|null=null;
  async function verifyCycle(){attempts++;stage="CHAIN_HEAD";verifyingBlock=undefined;verifyingTransaction=undefined;try{
    const tip=await rpc.getBlockNumber(),target=tip-2n;if(target<BigInt(m.deployment.blockNumber)){status="pending";stage="BEFORE_CONFIRMATIONS";return;}
    // Keep an already verified unchanged checkpoint readable while refreshing
    // its pins. The HTTP reader still rechecks its exact canonical hash. A new
    // target or any verification error immediately makes the read model pending.
    if(checkpointHeight===undefined||BigInt(checkpointHeight)!==target)status="pending";
    targetHeight=String(target);verifyingBlock=String(target);stage="RUNTIME_BINDING";
    await verifySeaportVaultRuntime(rpc,m,target);
    stage="REORG_CANONICALITY";
    const checkpoints=await db.query("SELECT block_number,block_hash FROM rmt_seaport_v2_blocks ORDER BY block_number DESC LIMIT 64");
    let divergent:bigint|undefined,common=false;for(const p of checkpoints.rows){verifyingBlock=String(p.block_number);if(BigInt(p.block_number)>tip){divergent=BigInt(p.block_number);continue;}const h=await rpc.getBlock({blockNumber:BigInt(p.block_number)});if(h.hash?.toLowerCase()!==p.block_hash.toLowerCase())divergent=BigInt(p.block_number);else{common=true;break;}}
    // A deeper fixture reorg rebuilds this private read model from its exact
    // birth. Never retain an unprobed older branch as a canonical ancestor.
    if(divergent!==undefined&&!common)divergent=BigInt(m.deployment.blockNumber);
    if(divergent!==undefined)await rollbackSeaportVaultStore(db,divergent);
    stage="READ_CHECKPOINT";verifyingBlock=undefined;
    const saved=await readSeaportVaultStore(db),from=saved.checkpoint?BigInt(saved.checkpoint.blockNumber)+1n:BigInt(m.deployment.blockNumber);
    checkpointHeight=saved.checkpoint?.blockNumber;
    if(target-from>4096n)throw Error("Seaport V2 fixture span exceeded");
    let parent=saved.checkpoint?.blockHash;
    for(let height=from;height<=target;height++){
      stage="READ_BLOCK";verifyingBlock=String(height);verifyingTransaction=undefined;
      const h=await rpc.getBlock({blockNumber:height});if(!h.hash)throw Error("Seaport V2 header unavailable");
      stage="CANONICAL_PARENT";
      if(parent&&h.parentHash.toLowerCase()!==parent.toLowerCase())throw Error("Seaport V2 canonical ancestry mismatch");
      stage="READ_LOGS";
      const logs=await rpc.getLogs({address:m.vault,fromBlock:height,toBlock:height});if(logs.length>128)throw Error("Seaport V2 log bound exceeded");
      const events=parseEventLogs({abi:seaportVaultAbi,eventName:"PurchaseExecuted",strict:true,logs}),rows:SeaportVaultSettlement[]=[];
      const hashes=[...new Set(events.map(e=>e.transactionHash))];if(hashes.length>32)throw Error("Seaport V2 transaction bound exceeded");
      stage="SETTLEMENT_PROOF";
      for(const hash of hashes){if(!hash)throw Error("Seaport V2 log identity unavailable");verifyingTransaction=hash;rows.push(await verifySeaportVaultReceipt(rpc,m,hash as Hash));}
      verifyingTransaction=undefined;
      stage="CANONICAL_RECHECK";
      const canonical=await rpc.getBlock({blockNumber:height});if(canonical.hash!==h.hash)throw Error("Seaport V2 reorg during indexing");
      stage="COMMIT_BLOCK";
      await commitSeaportVaultBlock(db,{blockNumber:String(height),blockHash:h.hash,timestamp:new Date(Number(h.timestamp)*1000).toISOString()},rows,m);
      parent=h.hash;checkpointHeight=String(height);
    }
    status="ready";successfulCycles++;stage="READY";lastFailure=null;verifyingBlock=undefined;
  }catch(error){status="pending";lastFailure={stage,message:String(error instanceof Error?error.message:error).slice(0,2048),...(verifyingBlock&&{blockNumber:verifyingBlock}),...(verifyingTransaction&&{transactionHash:verifyingTransaction})};throw error;}}
  const verification=shareSeaportVerification(verifyCycle);
  const sync=()=>closed?Promise.resolve():verification.run();
  const timer=setInterval(()=>{void sync().catch(()=>{status="pending";});},200);
  const server=createServer(async(req,res)=>{try{
    const auth=req.headers.authorization??"",wanted="Bearer "+readKey;
    if(auth.length!==wanted.length||!timingSafeEqual(Buffer.from(auth),Buffer.from(wanted))){res.writeHead(404,{"Cache-Control":"no-store"});res.end();return;}
    const url=new URL(req.url??"/","http://127.0.0.1");if(req.method!=="GET"||url.pathname!=="/seaport-acquisition"||[...url.searchParams.keys()].some(k=>k!=="transaction")||url.searchParams.getAll("transaction").length>1){res.writeHead(404);res.end();return;}
    const transaction=url.searchParams.get("transaction")??undefined;if(transaction&&!/^0x[a-f0-9]{64}$/i.test(transaction)){res.writeHead(400);res.end();return;}
    if(status!=="ready")throw Error("Trace or canonical checkpoint pending");
    const stored=await readSeaportVaultStore(db,transaction);if(!stored.checkpoint)throw Error("Checkpoint pending");
    const h=await rpc.getBlock({blockNumber:BigInt(stored.checkpoint.blockNumber)});if(h.hash?.toLowerCase()!==stored.checkpoint.blockHash.toLowerCase())throw Error("Reorg pending");
    if(status!=="ready")throw Error("Canonical verification advanced during read");
    const body=json({schemaVersion:1,profile:m.profile,chainId:31337,productionExecution:false,status:"ready",...stored});if(Buffer.byteLength(body)>131072)throw Error("Read bound exceeded");res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store","Content-Length":Buffer.byteLength(body)});res.end(body);
  }catch{res.writeHead(503,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(json({status:"pending",productionExecution:false}));}});
  try{await new Promise<void>((done,fail)=>{server.once("error",fail);server.listen(port,"127.0.0.1",done);});await sync();}
  catch(error){closed=true;clearInterval(timer);if(server.listening)await new Promise<void>(done=>server.close(()=>done()));throw error;}
  return{sync,status:()=>status,diagnostics:()=>({status,running:Boolean(verification.current()),attempts,successfulCycles,stage,targetHeight,checkpointHeight,lastFailure}),close:async()=>{closed=true;clearInterval(timer);await verification.current()?.catch(()=>{});await new Promise<void>((done,fail)=>server.close(e=>e?fail(e):done()));}};
}
