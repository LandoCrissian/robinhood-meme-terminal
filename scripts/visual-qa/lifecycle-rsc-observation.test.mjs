import assert from "node:assert/strict";
import {test} from "node:test";
import {EventEmitter} from "node:events";
import {observeLifecycleRsc} from "./lifecycle-rsc-observation.mjs";

const origin="http://127.0.0.1:3200", token="0x"+"1".repeat(40);
const request=(path="/launches/"+token+"?_rsc=synthetic", extra={})=>({
  url:()=>path.startsWith("http")?path:origin+path, method:()=>"GET",
  failure:()=>({errorText:"synthetic body aborted"}), ...extra,
});
function harness(){
  const page=new EventEmitter();let current=token;
  const proof=observeLifecycleRsc(page,{origin,token:()=>current});
  const response=(req,status=200)=>page.emit("response",{request:()=>req,status:()=>status});
  return {page,proof,response,setToken:value=>{current=value;}};
}
const immediate=async(_description,probe)=>assert.equal(await probe(),true,"bounded observation did not terminate");
test("empty pending snapshot requires no new transaction refresh",async()=>{
  const {proof}=harness();assert.deepEqual(await proof.waitPending(immediate),[]);
});
test("headers leave a captured stream pending until its body finishes",async()=>{
  const {page,proof,response}=harness(),req=request();page.emit("request",req);response(req);
  let navigation=false,release;const waiting=new Promise(resolve=>{release=resolve;});
  const task=proof.waitPending(async(_description,probe)=>{
    assert.equal(await probe(),false);await waiting;assert.equal(await probe(),true);
  }).then(()=>{navigation=true;});
  await Promise.resolve();assert.equal(navigation,false);
  page.emit("requestfinished",req);release();await task;assert.equal(navigation,true);
  assert.equal(proof.snapshot()[0].status,"body-complete");
});
test("orphan response/completion cannot release an actually pending request",async()=>{
  const {page,proof,response}=harness(),req=request(),orphan=request();
  page.emit("request",req);response(req);
  await proof.waitPending(async(_description,probe)=>{
    response(orphan);page.emit("requestfinished",orphan);assert.equal(await probe(),false);
    page.emit("requestfinished",req);assert.equal(await probe(),true);
  });
  assert.equal(proof.snapshot().length,1);
});
test("foreign, other-token, non-RSC and POST requests are outside this action barrier",async()=>{
  const {page,proof,response}=harness();
  for(const req of [request("https://outside.invalid/launches/"+token+"?_rsc=x"),
    request("/launches/0x"+"2".repeat(40)+"?_rsc=x"),request("/api/launchpad/test-lifecycle"),
    request("/launches/"+token),request(undefined,{method:()=>"POST"})]){
    page.emit("request",req);response(req);
  }
  assert.deepEqual(proof.snapshot(),[]);await proof.waitPending(immediate);
});
test("prefetch and already terminal history do not add new prerequisites",async()=>{
  const {page,proof,response}=harness(),prefetch=request(undefined,{headers:()=>({"next-router-prefetch":"1"})});
  page.emit("request",prefetch);response(prefetch);await proof.waitPending(immediate);
  const old=request();page.emit("request",old);response(old);page.emit("requestfailed",old);
  await proof.waitPending(immediate);assert.equal(proof.snapshot()[1].status,"failed");
});
test("a legitimate token transition does not wait on an old token's stream",async()=>{
  const {page,proof,response,setToken}=harness(),old=request();page.emit("request",old);response(old);
  setToken("0x"+"2".repeat(40));await proof.waitPending(immediate);
  assert.equal(proof.snapshot()[0].status,"pending");
});
test("failure is terminal quiescence and remains a failed diagnostic row",async()=>{
  for(const failure of ["net::ERR_ABORTED","Load request cancelled","Load failed","net::ERR_CONNECTION_RESET"]){
    const {page,proof,response}=harness(),req=request(undefined,{failure:()=>({errorText:failure})});
    page.emit("request",req);response(req);
    const rows=await proof.waitPending(async(_description,probe)=>{
      assert.equal(await probe(),false);page.emit("requestfailed",req);assert.equal(await probe(),true);
    });
    assert.equal(rows[0].status,"failed");assert.equal(rows[0].failure,failure);
    assert.equal(rows[0].supersededBy,undefined);assert.equal(rows[0].status==="body-complete",false);
  }
});
test("HTTP error quiescence does not assert authentication, freshness or data success",async()=>{
  for(const status of [401,503,undefined]){
    const {page,proof,response}=harness(),req=request();page.emit("request",req);
    if(status!==undefined)response(req,status);
    const rows=await proof.waitPending(async(_description,probe)=>{
      page.emit("requestfinished",req);assert.equal(await probe(),true);
    });
    assert.equal(rows[0].httpStatus,status);assert.equal(rows[0].status,"body-complete");
    assert.equal(rows[0].verified,undefined);
  }
});
test("captured streams must all terminate; a later request does not fabricate their completion",async()=>{
  const {page,proof,response}=harness(),one=request(),two=request(),later=request();
  for(const req of [one,two]){page.emit("request",req);response(req);}
  const rows=await proof.waitPending(async(_description,probe)=>{
    page.emit("requestfinished",one);assert.equal(await probe(),false);
    page.emit("request",later);response(later);page.emit("requestfinished",later);assert.equal(await probe(),false);
    page.emit("requestfailed",two);assert.equal(await probe(),true);
  });
  assert.deepEqual(rows.map(row=>row.status),["body-complete","failed"]);
});
