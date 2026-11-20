// Task087 public GET observations only. No RPC, wallet, credentials or mutation.
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
const sha=b=>createHash("sha256").update(b).digest("hex"),root=new URL("./",import.meta.url);
const site="https://www.rmtlaunch.fun",worker="https://robinhood-meme-terminal-production.up.railway.app";
const endpoints=[
 ["website-home",site+"/"],
 ["website-config",site+"/api/launchpad/config"],
 ["website-history",site+"/api/launchpad/launches"],
 ["website-new-engine",site+"/api/launchpad/new-engine"],
 ["website-production-creation",site+"/api/launchpad/production-creation"],
 ["website-production-earnings",site+"/api/launchpad/production-earnings"],
 ["website-create-page",site+"/create-token"],
 ["website-my-launches",site+"/my-launches"],
 ["website-wallet",site+"/wallet"],
 ["worker-health",worker+"/health"],
 ["worker-ready",worker+"/ready"],
 ["worker-history-no-auth",worker+"/historical-launches"],
 ["worker-new-engine-no-auth",worker+"/curve-launches"],
 ["worker-new-engine-invalid-auth",worker+"/curve-launches?limit=1",true]
];
const headers=["content-type","cache-control","age","date","etag","cache-status","netlify-cdn-cache-control","retry-after","www-authenticate","server"];
const forbiddenKey=/(?:password|private.?key|seed.?phrase|secret|authorization|cookie|api.?key|database.?url|access.?token|refresh.?token|bearer|credential)/i;
function publicJson(value,depth=0){if(depth>16)return false;if(value===null||typeof value!=="object")return true;return Object.entries(value).every(([key,v])=>!forbiddenKey.test(key)&&publicJson(v,depth+1));}
async function observe([id,url,invalidBearer=false]){
 const result={id,url,method:"GET",observedAtUtc:new Date().toISOString(),requestAuthentication:invalidBearer?"FIXED_KNOWN_INVALID_PROBE_NOT_A_CREDENTIAL":"NONE"};
 let response;
 try{
  response=await fetch(url,{method:"GET",credentials:"omit",redirect:"error",signal:AbortSignal.timeout(8000),headers:{accept:"application/json,text/html;q=0.5",...(invalidBearer?{authorization:"Bearer rmt-task087-invalid-probe"}:{})}});
  Object.assign(result,{httpStatus:response.status,headers:Object.fromEntries(headers.map(k=>[k,response.headers.get(k)]).filter(([,v])=>v!==null))});
  const json=/^application\/json(?:;|$)/i.test(response.headers.get("content-type")??""),limit=json?65536:262144,reader=response.body?.getReader();let size=0,chunks=[];
  if(!reader)throw Object.assign(Error(),{name:"NoBody"});
  for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();return{...result,state:"UNAVAILABLE",reason:"RESPONSE_BOUND",limit};}chunks.push(value);}
  const bytes=Buffer.concat(chunks,size),raw=new TextDecoder("utf-8",{fatal:true}).decode(bytes);Object.assign(result,{responseBytes:size,bodySha256:sha(bytes)});
  if(json){const body=JSON.parse(raw);if(!publicJson(body))return{...result,state:"UNAVAILABLE",reason:"SENSITIVE_KEY_OR_DEPTH_REJECTED_NO_BODY_RETAINED"};Object.assign(result,{rawUtf8:raw,body});}
  else result.bodyRetention="OMITTED_HTML_BODY_HASH_ONLY";
  return{...result,state:"OBSERVED",completedAtUtc:new Date().toISOString()};
 }catch(error){await response?.body?.cancel().catch(()=>{});return{...result,state:"UNAVAILABLE",reason:["TimeoutError","AbortError"].includes(error?.name)?"TIMEOUT":"TRANSPORT_OR_DECODE"};}
}
const mode=process.argv[2]??"initial";
if(!["initial","continuity"].includes(mode))throw Error("Only fixed observation sets are supported");
const selected=mode==="initial"?endpoints:endpoints.filter(([id])=>["website-history","worker-health","worker-ready"].includes(id));
const startedAtUtc=new Date().toISOString(),observations=[];
// Max two public reads in flight; no retry, RPC, signed method or state override.
for(let i=0;i<selected.length;i+=2)observations.push(...await Promise.all(selected.slice(i,i+2).map(observe)));
const result={schemaVersion:1,scope:"TASK087_BOUNDED_PUBLIC_HTTPS_GET_NOT_MUTATION_OR_PRODUCTION_ACCEPTANCE",mode,startedAtUtc,completedAtUtc:new Date().toISOString(),producerSha256:sha(readFileSync(fileURLToPath(import.meta.url))),limits:{requests:selected.length,concurrency:2,timeoutMs:8000,jsonBytes:65536,htmlBytes:262144,retries:0},stateChangesAuthorized:false,observations};
writeFileSync(new URL(mode+"-public-reads.json",root),JSON.stringify(result,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({mode,completedAtUtc:result.completedAtUtc,observations:observations.map(({id,state,httpStatus,body})=>({id,state,httpStatus,body}))}));
