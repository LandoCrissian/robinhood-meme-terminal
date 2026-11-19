import test from "node:test";
import assert from "node:assert/strict";
import {shareSeaportVerification} from "./seaport-acquisition-worker.js";

test("Explicit Seaport synchronization awaits the active background verification",async()=>{
 let release!:()=>void,calls=0,completed=false;
 const gate=shareSeaportVerification(async()=>{calls++;await new Promise<void>(done=>{release=done;});completed=true;});
 const background=gate.run();await Promise.resolve();const explicit=gate.run();
 assert.equal(background,explicit,"Concurrent callers share the actual verification promise");assert.equal(calls,1);assert.equal(completed,false);
 let observed=false;const observer=explicit.then(()=>{observed=true;assert.equal(completed,true);});await Promise.resolve();assert.equal(observed,false,"The caller cannot sample transient pending state by returning early");
 release();await Promise.all([background,observer]);assert.equal(observed,true);assert.equal(gate.current(),undefined);
});

test("A failed canonical verification reaches every waiter and permits a later retry",async()=>{
 let reject!:(error:Error)=>void,calls=0;const failure=Error("Synthetic exact-trace outage");
 const gate=shareSeaportVerification(async()=>{calls++;if(calls===1)await new Promise<void>((_done,fail)=>{reject=fail;});});
 const first=gate.run();await Promise.resolve();const second=gate.run(),results=Promise.allSettled([first,second]);reject(failure);
 for(const result of await results){assert.equal(result.status,"rejected");if(result.status==="rejected")assert.equal(result.reason,failure);}
 assert.equal(gate.current(),undefined);await gate.run();assert.equal(calls,2);
});
