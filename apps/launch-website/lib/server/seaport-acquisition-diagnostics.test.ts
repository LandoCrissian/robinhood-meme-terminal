import test from "node:test";
import assert from "node:assert/strict";
import {seaportFixturePreparationDiagnostic} from "./seaport-acquisition-diagnostics";
test("local preparation diagnostics retain only stable stage/name/revert selector",()=>{
 const error=Object.assign(Error("https://rpc.invalid/?token=do-not-retain"),{name:"CallExecutionError",stack:"Bearer do-not-retain",headers:{Authorization:"do-not-retain"},cause:{data:"0xaf610693"+"01".repeat(64)}});
 assert.deepEqual(seaportFixturePreparationDiagnostic("SIMULATE_PENDING",error),{stage:"SIMULATE_PENDING",errorName:"CallExecutionError",revertSelector:"0xaf610693"});
 assert.equal(JSON.stringify(seaportFixturePreparationDiagnostic("SIMULATE_PENDING",error)).includes("do-not-retain"),false);
});
test("unknown stages, arbitrary names and cyclic/malformed provider payloads stay bounded",()=>{
 const error:{name:string;data:string;cause?:unknown}={name:"Bearer do-not-retain",data:"not a revert"};error.cause=error;
 assert.deepEqual(seaportFixturePreparationDiagnostic("https://do-not-retain",error),{stage:"UNAVAILABLE",errorName:"Error"});
 assert.deepEqual(seaportFixturePreparationDiagnostic("LOCAL_CONTEXT",{data:"0x"+"12".repeat(2000)}),{stage:"LOCAL_CONTEXT",errorName:"Error"});
});
