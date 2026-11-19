import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import {join} from "node:path";
import {createRequire} from "node:module";
import {createReadOnlySeaportWatcher} from "./listing-watcher.mjs";
import {ingestOwnerSuppliedSignedOrder} from "./owner-supplied-order.mjs";
import {createSeaportListingWatchStore} from "../../apps/indexer/dist/seaport-listing-watch-store.js";
import {verifySeaportVaultRuntime} from "../../apps/indexer/dist/seaport-acquisition-evidence.js";
import {readSeaportSafeState,safeAuthorityIdentity,seaportSafePins,seaportSafeVaultSignatures} from "../../packages/launchpad-common/seaport-vault-safe.mjs";
const require=createRequire(new URL("../../apps/indexer/package.json",import.meta.url)),v=require("viem"),same=(a,b)=>a.toLowerCase()===b.toLowerCase(),json=x=>JSON.stringify(x,(_,a)=>typeof a==="bigint"?String(a):a,2)+"\n";
const abi=v.parseAbi([...seaportSafeVaultSignatures,"function totalSpent(address) view returns(uint256)","function periodSpent(address,uint256) view returns(uint256)","function lastPurchaseAt() view returns(uint48)"]);
/** Host adapters are deliberately read-only. The worker invokes verifiedCycle
 * after its canonical commit. No wallet, signer or submission function enters
 * the watcher; all transaction counts are asserted unchanged by each poll. */
export async function createBrowserListingWatcher({fixture,manifest:m,rpc,getDb,out}){
 const witness=v.createPublicClient({transport:v.http(rpc.transport.url,{retryCount:0,timeout:8000}),cacheTime:0}),payer=fixture.accounts.fee.address,configuration={profile:"seaport-watch-local-31337",chainId:31337,vault:m.vault,projectToken:m.projectToken,seaport:m.seaport,gasPayer:payer,vaultRuntimeHash:m.vaultRuntimeHash};
 let clockMs=Number((await rpc.getBlock()).timestamp)*1000,entry,requested=false,activeDb,store,lastResult,cycles=0,verifyCalls=0,simulationCalls=0;
 const evidence={schemaVersion:1,profile:configuration.profile,status:"incomplete",production:false,publicFeedAuthenticated:false,sourceKind:"OWNER_SUPPLIED",broadcasts:0,signatureRequests:0,polls:[],checks:{}},save=()=>writeFileSync(join(out,"seaport-listing-watcher-evidence.json"),json(evidence));
 async function currentStore(){const db=getDb();if(db!==activeDb){store=await createSeaportListingWatchStore(db,m,watcher.bindingHash);activeDb=db;}return store;}
 const watcher=createReadOnlySeaportWatcher({configuration,now:()=>clockMs,codecs:v,store:{load:async hash=>(await currentStore()).load(hash),commit:async(revision,state)=>(await currentStore()).commit(revision,state)},
  async readState({orderHash,order}){
   const h=await rpc.getBlock();assert.ok(h.number&&h.hash);await verifySeaportVaultRuntime(rpc,m,h.number);
   const read=(functionName,args=[])=>rpc.readContract({address:m.vault,abi,functionName,args,blockNumber:h.number}),controller=await read("controller"),code=(await rpc.getCode({address:controller,blockNumber:h.number}))??"0x";
   let authority;if(code!=="0x"){assert.equal(v.keccak256(code),seaportSafePins.proxyHash);const state=await readSeaportSafeState(rpc,controller,h.number,v);authority={profile:"canonical-safe-1.4.1",identity:safeAuthorityIdentity(state),nonce:state.nonce,singleton:state.singleton,handler:state.handler,modules:"empty",guard:v.zeroAddress};}else authority={profile:"plain-eoa",controller,code};
   const [ce,pe,enabled,p,available,spent,period,last,latestNonce,pendingNonce,balance]=await Promise.all([read("controllerEpoch"),read("policyEpoch"),read("purchasesEnabled"),read("policy"),read("available",[(await read("policy"))[0]]),read("totalSpent",[(await read("policy"))[0]]),read("periodSpent",[(await read("policy"))[0],h.timestamp/86400n]),read("lastPurchaseAt"),rpc.getTransactionCount({address:payer,blockNumber:h.number}),rpc.getTransactionCount({address:payer,blockTag:"pending"}),rpc.getBalance({address:payer,blockNumber:h.number})]);
   const state={chainId:31337,vault:m.vault,projectToken:m.projectToken,seaport:m.seaport,vaultRuntimeHash:m.vaultRuntimeHash,runtimeVerified:true,productionExecutionAvailable:false,canonical:{number:String(h.number),hash:h.hash,timestamp:String(h.timestamp)},controller,controllerAuthorityHash:v.keccak256(v.stringToHex(JSON.stringify(authority))),controllerEpoch:String(ce),policyEpoch:String(pe),purchasesEnabled:enabled,policy:{currency:p[0],perNftCap:String(p[1]),totalBudget:String(p[2]),periodBudget:String(p[3]),cooldownSeconds:String(p[4])},availableWei:String(available),totalSpentWei:String(spent),periodSpentWei:String(period),lastPurchaseAt:String(last),gasPayer:{address:payer,latestNonce:String(latestNonce),pendingNonce:String(pendingNonce),balanceWei:String(balance)}};
   if(order){const n=order.parameters.offer[0],pin=m.collections.find(c=>same(c.address,n.token));assert.ok(pin);const c=await read("collections",[pin.address]);state.collection={address:pin.address,standard:pin.standard,enabled:c[2],tokenIdAllowed:c[3]||await read("allowedTokenId",[pin.address,BigInt(n.identifierOrCriteria)]),runtimeHash:c[0]};state.orderConsumed=await read("orderConsumed",[orderHash]);}
   return state;
  },
  discover:async()=>entry?{status:"AVAILABLE",entries:[entry]}:{status:"UNAVAILABLE",entries:[]},
  async verifyEntry(e,{state}){
   verifyCalls++;const options=await fixture.options(e.envelope.order);return ingestOwnerSuppliedSignedOrder(JSON.stringify(e.envelope),{profile:"seaport-local-31337-v1",nowMs:Number(BigInt(state.canonical.timestamp))*1000,verifierOptions:{...options,rpc,witnessRpc:witness,pins:fixture.pins}});
  },
  async prepareUnsigned({intent}){
   simulationCalls++;const call={account:intent.from,to:intent.to,data:intent.data,value:0n};await rpc.call({...call,blockTag:"pending"});const [gas,priority,h]=await Promise.all([rpc.estimateGas(call),rpc.estimateMaxPriorityFeePerGas(),rpc.getBlock()]);return{request:{...intent,gas:v.toHex(gas*125n/100n),maxFeePerGas:v.toHex((h.baseFeePerGas??0n)*2n+priority),maxPriorityFeePerGas:v.toHex(priority)},simulationSucceeded:true};
  },
  isCanonical:async observed=>same((await rpc.getBlock({blockNumber:BigInt(observed.blockNumber)})).hash,observed.blockHash)
 });
 async function verifiedCycle(point){if(!requested)return;requested=false;const before=await rpc.getTransactionCount({address:payer,blockTag:"pending"});clockMs=Number((await rpc.getBlock()).timestamp)*1000;lastResult=await watcher.tick({force:true});assert.equal(await rpc.getTransactionCount({address:payer,blockTag:"pending"}),before,"Read-only watcher never signs or broadcasts");cycles++;evidence.polls.push({checkpoint:point,result:lastResult,verifiedCurrentOrderCalls:verifyCalls,unsignedSimulations:simulationCalls,gasPayerNonce:String(before),broadcast:false,signatureRequested:false});save();}
 async function force(sync){const count=cycles;requested=true;await sync();for(let i=0;cycles===count&&i<30;i++)await new Promise(done=>setTimeout(done,100));assert.ok(cycles>count,"Existing verified worker cycle must invoke watcher");return lastResult;}
 return{verifiedCycle,async prepare(sync,restart){
   await fixture.mint(301,false);const order=await fixture.makeOrder({id:301}),h=await rpc.getBlock();entry={sourceKind:"OWNER_SUPPLIED",envelope:{schemaVersion:1,kind:"OWNER_SUPPLIED",side:"LISTING",provenance:{obtainedAt:new Date(Number(h.timestamp)*1000).toISOString(),reference:"Task084 genuine local EOA signed order"},order}};
   const before=await rpc.getTransactionCount({address:payer,blockTag:"pending"}),result=await force(sync);assert.equal(result.status,"PREPARED",json(result));const state=await(await currentStore()).load(watcher.bindingHash);assert.equal(state.records.length,1);assert.equal(state.records[0].orderHash,result.candidate.orderHash);assert.equal(state.records[0].executionApproved,false);assert.equal(state.records[0].walletConfirmationRequired,true);assert.equal(state.records[0].sourceKind,"OWNER_SUPPLIED");assert.equal(state.records[0].publicListingVerified,false);assert.equal(await rpc.getTransactionCount({address:payer,blockTag:"pending"}),before);evidence.checks.actualSourceCurrentOrderAndUnsignedSimulation=true;evidence.checks.noOwnerSignaturesOrBroadcasts=true;
   await restart();const durable=await(await currentStore()).load(watcher.bindingHash);assert.deepEqual(durable.records,state.records);const duplicate=await force(sync);assert.equal(duplicate.status,"IDLE",json(duplicate));assert.equal(duplicate.reason,"ORDER_ALREADY_PREPARED");assert.equal((await(await currentStore()).load(watcher.bindingHash)).records.length,1);evidence.checks.actualPostgresServerRestartRetainsCandidate=true;evidence.checks.duplicateOrderNotPreparedTwice=true;evidence.candidate=state.records[0];save();return result;
  },async assertOff(sync){const result=await force(sync);assert.equal(result.status,"OFF",json(result));const state=await(await currentStore()).load(watcher.bindingHash);assert.equal(state.records.length,1);assert.equal(state.records[0].status,"INVALIDATED");evidence.checks.minedSafeDisableInvalidatesUnsignedCandidate=true;evidence.finalState=state;evidence.status="PASS";save();return evidence;}
 };
}
