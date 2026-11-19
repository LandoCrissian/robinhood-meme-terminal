import test from "node:test";
import assert from "node:assert/strict";
import {toFunctionSelector} from "viem";
import {saveSeaportJournal,loadSeaportJournal,pendingSeaportRecovery} from "../seaport-acquisition-recovery";
import {seaportAcquisitionReviewHash,type SeaportAcquisitionReview} from "../seaport-acquisition";

test("A canonically reverted original request remains recoverable after reload without losing its identity",()=>{
 const values=new Map<string,string>(),storage={get length(){return values.size;},getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},key:(i:number)=>[...values.keys()][i]??null,removeItem:(key:string)=>{values.delete(key);},clear:()=>values.clear()}as Storage;
 const account="0x1111111111111111111111111111111111111111",vault="0x2222222222222222222222222222222222222222",hash=("0x"+"a".repeat(64))as `0x${string}`;
 const body={schemaVersion:1,profile:"rmt-seaport-acquisition-local-v2",chainId:31337,scope:"synthetic-local",productionExecution:false,operation:"disable",account,vault,runtimeHash:hash,controllerEpoch:"1",policyEpoch:"1",expiresAt:1_900_000_000,fields:{},request:{type:"0x2",chainId:"0x7a69",from:account,to:vault,data:toFunctionSelector("disablePurchases()"),value:"0x0",nonce:"0x3",gas:"0x5208",maxFeePerGas:"0x1",maxPriorityFeePerGas:"0x0"},maximumNetworkFeeWei:"21000",listing:null}as Omit<SeaportAcquisitionReview,"reviewHash">;
 const review={...body,reviewHash:seaportAcquisitionReviewHash(body)};
 saveSeaportJournal(storage,{review,stage:"pending",hash});const reverted=saveSeaportJournal(storage,{review,stage:"reverted",hash});
 assert.equal(values.size,1);assert.deepEqual(loadSeaportJournal(storage,vault),reverted);assert.deepEqual(loadSeaportJournal(storage,vault)?.review.request,body.request);assert.equal(loadSeaportJournal(storage,vault)?.stage,"reverted");
 const confirmed=saveSeaportJournal(storage,{review,stage:"confirmed",hash});
 for(const result of[{status:"pending"},{status:"reorged",reviewHash:review.reviewHash}]){const downgraded=pendingSeaportRecovery(confirmed,result);assert.ok(downgraded);assert.equal(downgraded.stage,"pending");assert.deepEqual(downgraded.review,confirmed.review);assert.equal(downgraded.hash,hash);saveSeaportJournal(storage,downgraded);assert.equal(loadSeaportJournal(storage,vault)?.stage,"pending");assert.deepEqual(loadSeaportJournal(storage,vault)?.review.request,body.request);}
 assert.throws(()=>pendingSeaportRecovery(confirmed,{status:"pending",reviewHash:"0x"+"b".repeat(64)}),/identity mismatch/);
});
