import assert from 'node:assert/strict';
import {writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
assert.ok(process.argv[2],'Supply a fresh absolute output JSON path');
const output=resolve(process.argv[2]);assert.equal(existsSync(output),false,'Preserve previous observations');
import {hasCurveRegistration} from '../../../../apps/launch-website/lib/curve-lifecycle.ts';
import {curveProductionPins,curveProductionDeployment} from '../../../../apps/launch-website/lib/server/curve-production.ts';
const report:any={startedAt:new Date().toISOString(),site:'ebdf8492-ff86-452f-b4cc-45d7865c8311',deploy:'6b0096332beb675b1d8e0f49',
 sourceCommit:'b79515752ef42e88850ac2cea953955a3bb03087',scope:'ACTUAL_HOSTED_READ_ONLY_ACCEPTANCE',publicResponseContract:'PINNED_SANITIZED_STATUS_LAUNCHES_CHECKPOINT_NO_INVENTED_UPSTREAM_METADATA',observations:[],boundary:[],rpcReads:[],productionFinancialCalls:0};
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');save();
async function rpc(url:string,method:string,params:any[]){const request={jsonrpc:'2.0',id:report.rpcReads.length+1,method,params};
 assert.ok(['eth_chainId','eth_getBlockByNumber'].includes(method));
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(10_000)});
 const response=await r.json();report.rpcReads.push({url,request,response,httpStatus:r.status});save();assert.equal(r.status,200);assert.equal(response.error,undefined);return response.result;}
function validatePublicDiscovery(body:any,now:number){
 assert.ok(body&&typeof body==='object'&&!Array.isArray(body));
 assert.deepEqual(Object.keys(body).sort(),['checkpoint','launches','status']);
 assert.equal(body.status,'ready');assert.ok(Array.isArray(body.launches)&&body.launches.length<=25);
 const p=body.checkpoint;assert.ok(p&&typeof p==='object');
 assert.deepEqual(Object.keys(p).sort(),['blockHash','blockNumber','confirmations','finality','l1Finality','timestamp']);
 assert.match(p.blockNumber,/^[1-9][0-9]{0,15}$/);assert.ok(BigInt(p.blockNumber)>=curveProductionDeployment.blockNumber);
 assert.match(p.blockHash,/^0x[0-9a-f]{64}$/i);assert.equal(p.finality,'l2-confirmed');assert.equal(p.l1Finality,'unverified');
 assert.ok(Number.isInteger(p.confirmations)&&p.confirmations>=20&&p.confirmations<=256);
 assert.match(p.timestamp,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/);
 assert.ok(Number.isFinite(Date.parse(p.timestamp)));assert.ok(now-Date.parse(p.timestamp)>=-15000&&now-Date.parse(p.timestamp)<120000);
 for(const row of body.launches){assert.ok(hasCurveRegistration(row));assert.equal(row.factory.toLowerCase(),curveProductionPins.factory[0].toLowerCase());assert.equal(row.projectRegistry.toLowerCase(),curveProductionPins.registry[0].toLowerCase());assert.deepEqual(row.checkpoint,p);}
 return body;
}
async function observe(){const startedAt=new Date().toISOString(),url='https://www.rmtlaunch.fun/api/launchpad/new-engine';
 const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15_000)});
 const bytes=Buffer.from(await r.arrayBuffer());assert.ok(bytes.length<=65536);
 const body=JSON.parse(bytes.toString());const readAt=Date.now();const parsed=body;
 const row:any={startedAt,finishedAt:new Date(readAt).toISOString(),url,status:r.status,requestId:r.headers.get('x-nf-request-id'),
 cacheControl:r.headers.get('cache-control'),cdnCache:r.headers.get('netlify-cdn-cache-control'),cacheStatus:r.headers.get('cache-status'),
 parsedStatus:parsed.status,body};report.observations.push(row);save();assert.equal(r.status,200);validatePublicDiscovery(body,readAt);assert.equal(parsed.status,'ready');
 assert.match(row.cacheControl,/no-store/);assert.ok('checkpoint' in parsed);
 if(!('checkpoint' in parsed))throw Error('No current checkpoint');
 row.ageMs=readAt-Date.parse(parsed.checkpoint.timestamp);assert.ok(row.ageMs>=-15000&&row.ageMs<120000);
 const height=BigInt(parsed.checkpoint.blockNumber),tag='0x'+height.toString(16);
 const anchors=[];
 for(const provider of ['https://rpc.mainnet.chain.robinhood.com','https://robinhood.api.pocket.network']){
  assert.equal(BigInt(await rpc(provider,'eth_chainId',[])),4663n);
  let b:any=null;for(let attempt=0;attempt<6;attempt++){b=await rpc(provider,'eth_getBlockByNumber',[tag,false]);if(b)break;assert.ok(Date.now()-Date.parse(parsed.checkpoint.timestamp)<120000,'Canonical witness freshness deadline');await new Promise(done=>setTimeout(done,2000));}assert.ok(b,'Canonical witness did not return the exact checkpoint');
  assert.equal(BigInt(b.number),height);assert.equal(b.hash.toLowerCase(),parsed.checkpoint.blockHash.toLowerCase());
  assert.equal(Number(BigInt(b.timestamp))*1000,Date.parse(parsed.checkpoint.timestamp));
  anchors.push({provider,number:b.number,hash:b.hash,timestamp:b.timestamp});
 }
 row.canonicalBothProviders=anchors;row.canonicalConfirmedAt=new Date().toISOString();row.canonicalConfirmedAgeMs=Date.now()-Date.parse(parsed.checkpoint.timestamp);assert.ok(row.canonicalConfirmedAgeMs<120000);save();}
try{
 await observe();
 // Observe again beyond the reader's maximum15s shared-cache lifetime.
 await new Promise(done=>setTimeout(done,25_000));
 await observe();
 assert.ok(BigInt(report.observations[1].body.checkpoint.blockNumber)>BigInt(report.observations[0].body.checkpoint.blockNumber));
 for(const [method,path] of [['GET','/api/launchpad/config'],['POST','/api/launchpad/production-creation'],['POST','/api/launchpad/production-earnings'],['POST','/api/account/nonce']]){
  const r=await fetch('https://www.rmtlaunch.fun'+path,{method,redirect:'error',signal:AbortSignal.timeout(15_000),...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});
  const body=await r.json();report.boundary.push({method,path,status:r.status,body,requestId:r.headers.get('x-nf-request-id')});save();
  if(method==='GET'){assert.equal(r.status,200);assert.equal(body.status,'disabled');}else assert.equal(r.status,404);
 }
 const denied=await fetch('https://robinhood-meme-terminal-production.up.railway.app/curve-launches',{redirect:'error',signal:AbortSignal.timeout(15_000)});
 report.unauthenticatedWorkerStatus=denied.status;await denied.body?.cancel();assert.equal(denied.status,401);
 report.status='PASS_HOSTED_CANONICAL_READS_FINANCIAL_BOUNDARY_CLOSED';report.completedAt=new Date().toISOString();save();
 console.log(JSON.stringify({status:report.status,deploy:report.deploy,observations:report.observations.map(({status,requestId,ageMs,body}:any)=>({status,requestId,ageMs,checkpoint:body.checkpoint,launches:body.launches.length})),boundary:report.boundary.map(({method,path,status}:any)=>({method,path,status})),unauthenticatedWorkerStatus:denied.status},null,2));
}catch(error){report.status='FAIL_NO_FINANCIAL_ACTIVATION';report.error=String((error as Error).message).slice(0,1000);save();throw error;}
