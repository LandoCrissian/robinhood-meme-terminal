import test from "node:test";
import assert from "node:assert/strict";
import {checkpointReached,traceFailureReached} from "./browser-checkpoint.mjs";
test("A ready cycle from before mining cannot satisfy the required confirmed checkpoint",()=>{
 const old={status:"ready",targetHeight:"57648372",checkpointHeight:"57648372",lastFailure:null};
 assert.equal(checkpointReached(old,57648374n),false);
 assert.equal(checkpointReached({...old,targetHeight:"57648374"},57648374n),false);
 assert.equal(checkpointReached({...old,targetHeight:"57648374",checkpointHeight:"57648374"},57648374n),true);
 assert.equal(checkpointReached({...old,targetHeight:"57648374",checkpointHeight:"57648375"},57648374n),false);
 assert.equal(checkpointReached({...old,status:"pending",targetHeight:"57648374",checkpointHeight:"57648374"},57648374n),false);
});
test("A trace outage must bind the new target, failing receipt block and exact transaction",()=>{
 const receipt={blockNumber:"57648374",transactionHash:"0x"+"a".repeat(64)},pending={status:"pending",targetHeight:"57648374",checkpointHeight:"57648373",lastFailure:{stage:"SETTLEMENT_PROOF",blockNumber:receipt.blockNumber,transactionHash:receipt.transactionHash}};
 assert.equal(traceFailureReached(pending,57648374n,receipt),true);
 for(const mutation of[{targetHeight:"57648372"},{status:"ready"},{lastFailure:{...pending.lastFailure,stage:"RUNTIME_BINDING"}},{lastFailure:{...pending.lastFailure,blockNumber:"57648373"}},{lastFailure:{...pending.lastFailure,transactionHash:"0x"+"b".repeat(64)}}])assert.equal(traceFailureReached({...pending,...mutation},57648374n,receipt),false);
});
