import assert from "node:assert/strict";
import { mock } from "node:test";
import { cachedPublicWorkspaceRead, readPublicWorkspace } from "./public-workspace-read";
async function run() {
 const fetchBefore=globalThis.fetch; let calls=0, release:(v:Response)=>void=()=>{};
 mock.timers.enable({apis:["Date"],now:100000});
 try {
  globalThis.fetch=async()=>{calls++;return new Promise<Response>(r=>{release=r;});};
  const key="/api/vnext/asset-workspace?address=0x1111111111111111111111111111111111111111&view=core";
  const a=readPublicWorkspace(key),b=readPublicWorkspace(key);
  assert.equal(calls,1,"same public read coalesces");release(Response.json({resolution:{name:"cached"}}));
  assert.deepEqual(await a,await b);await readPublicWorkspace(key);assert.equal(calls,1);
  mock.timers.tick(60001);
  globalThis.fetch=async()=>{calls++;return new Response(null,{status:503});};
  await assert.rejects(()=>readPublicWorkspace(key));
  assert.deepEqual(cachedPublicWorkspaceRead(key),{resolution:{name:"cached"}},"last value survives failed revalidation");
  for(const url of ["/api/vnext/quotes","/api/vnext/verify","/api/vnext/authorize","/api/wallet/balances","https://foreign.invalid/api/vnext/asset-workspace?"])
   await assert.rejects(()=>readPublicWorkspace(url));
  assert.equal(calls,2,"execution/private paths cannot enter public cache");
  assert.equal(cachedPublicWorkspaceRead(key.replace("1111","2222")),undefined,"no cross-token snapshot");
 } finally {globalThis.fetch=fetchBefore;mock.timers.reset();}
 console.log("Public selected-token cache: coalescing, TTL, stale retention and execution/private isolation PASS.");
}
void run().catch(error=>{console.error(error);process.exitCode=1;});
