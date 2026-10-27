import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createSharedZeroXFetch, POLICY } from './shared-zero-x-quota.mts';
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const real=Boolean(process.env.TASK121_REAL_REDIS_URL);
const settings=()=>({RMT_ZEROX_QUOTA_REDIS_URL:process.env.TASK121_REAL_REDIS_URL??'https://test.upstash.io',RMT_ZEROX_QUOTA_REDIS_TOKEN:process.env.TASK121_REAL_REDIS_TOKEN??'synthetic-test-only'});
const events:Array<Record<string,unknown>>=[];let upstream=0;
const transport:typeof fetch=async(input,init)=>{
 const url=new URL(String(input));
 if(url.hostname==='api.0x.org'){
  upstream++;await wait(Number(url.searchParams.get('delay')??20));
  if(url.searchParams.has('timeout'))throw Error('Synthetic provider timeout');
  return new Response('{}',{status:url.searchParams.has('limit')?429:200,headers:url.searchParams.has('limit')?{'Retry-After':'2'}:{}});
 }
 if(real)return fetch(input,init);
 return fetch(process.env.TASK121_REDIS_BRIDGE!,init);
};
const guarded=createSharedZeroXFetch(transport,settings,event=>events.push(event));
if(process.argv.includes('--worker')){
 process.on('message',async(message:any)=>{
  const started=performance.now();
  const responses=await Promise.all(Array.from({length:message.count??1},(_,i)=>guarded(`https://api.0x.org/swap/allowance-holder/${message.kind??'quote'}?syntheticSession=${message.session??'same'}${message.same?'':i}${message.limit?'&limit=1':''}`)));
  process.send?.({statuses:responses.map(x=>x.status),upstream,events,elapsedMs:performance.now()-started});
  process.disconnect();
 });
} else {
 let bridge:ReturnType<typeof createServer>|undefined;
 if(!real){
  bridge=createServer(async(req,res)=>{
   try {let body='';for await(const chunk of req)body+=chunk;const command=JSON.parse(body);assert(command[0]==='EVAL');
    const {stdout}=await promisify(execFile)('redis-cli',['--json',...command],{maxBuffer:1000000});
    res.setHeader('content-type','application/json');res.end(JSON.stringify({result:JSON.parse(stdout)}));
   }catch{res.statusCode=503;res.end('{}');}
  });
  await new Promise<void>(resolve=>bridge!.listen(0,'127.0.0.1',resolve));
  process.env.TASK121_REDIS_BRIDGE='http://127.0.0.1:'+String((bridge.address() as any).port);
 }
 const checks:Array<Record<string,unknown>>=[];const workerResults:any[]=[];
 const workers=(count:number,message:object)=>Promise.all(Array.from({length:count},(_,index)=>new Promise<any>((resolve,reject)=>{
  const worker=fork(fileURLToPath(import.meta.url),['--worker'],{execArgv:['--experimental-strip-types'],env:process.env,stdio:['ignore','ignore','ignore','ipc']});
  const timer=setTimeout(()=>{worker.kill();reject(Error('Worker deadline'));},12000);
  worker.once('message',value=>{clearTimeout(timer);workerResults.push(value);resolve(value);});worker.once('error',reject);
  worker.send({...message,session:'session-'+index});
 })));
 try {
  await wait(1200);
  const initial=await workers(8,{count:2,kind:'quote'});
  const admitted=initial.flatMap(x=>x.events).filter(x=>x.decision==='admitted').map(x=>x.atMs as number).sort((a,b)=>a-b);
  assert(admitted.length>0);assert(initial.some(x=>x.statuses.includes(429)));
  for(const t of admitted)assert(admitted.filter(x=>x>=t&&x<t+POLICY.windowMs).length<=POLICY.limit);
  checks.push({name:'Independent processes share atomic rolling admission',workers:8,requests:16,admitted:admitted.length,denied:initial.flatMap(x=>x.statuses).filter(x=>x===429).length,pass:true});
  await wait(1300);
  for(let i=0;i<2;i++)assert.equal((await guarded('https://api.0x.org/swap/allowance-holder/price?distinct='+i)).status,200);
  assert.equal((await guarded('https://api.0x.org/swap/allowance-holder/price?distinct=3')).status,429);
  assert.equal((await guarded('https://api.0x.org/swap/allowance-holder/quote?firm=1')).status,200);
  checks.push({name:'Third capacity slot reserved for firm review',pass:true});
  await wait(1300);const before=upstream;
  const same=await Promise.all(Array.from({length:8},()=>guarded('https://api.0x.org/swap/allowance-holder/price?same=1')));
  assert(same.every(x=>x.status===200));assert.equal(upstream-before,1);
  checks.push({name:'Identical in-flight prices coalesced, no cached executable quote',requests:8,providerAttempts:1,pass:true});
  await wait(1300);
  assert.equal((await guarded('https://api.0x.org/swap/allowance-holder/quote?limit=1')).status,429);
  const limited=await workers(1,{count:1});assert.equal(limited[0].upstream,0);assert.deepEqual(limited[0].statuses,[429]);
  checks.push({name:'Provider Retry-After shared with a fresh process; no provider retry',retryAfterSeconds:2,pass:true});
  await wait(2150);assert.equal((await guarded('https://api.0x.org/swap/allowance-holder/quote?recovered=1')).status,200);
  checks.push({name:'Recovery after shared upstream cooldown',pass:true});
  let forbidden=0;
  const unavailable=createSharedZeroXFetch(async()=>{forbidden++;return new Response('{}',{status:503});},()=>({}));
  assert.equal((await unavailable('https://api.0x.org/swap/allowance-holder/quote')).status,503);assert.equal(forbidden,0);
  const malformed=createSharedZeroXFetch(async(input)=>{if(String(input).includes('api.0x.org'))forbidden++;return Response.json({result:[1]});},settings);
  assert.equal((await malformed('https://api.0x.org/swap/allowance-holder/quote')).status,503);assert.equal(forbidden,0);
  checks.push({name:'Missing, unavailable or malformed coordinator fails closed',upstreamAttempts:0,pass:true});
  await wait(1300);
  assert.equal((await guarded('https://api.0x.org/swap/allowance-holder/quote?timeout=1')).status,503);
  const timeout=await workers(1,{count:1});assert.equal(timeout[0].upstream,0);assert.deepEqual(timeout[0].statuses,[429]);
  checks.push({name:'Provider timeout consumes permit and shares conservative cooldown',pass:true});
  let passiveCalls=0;const passive=createSharedZeroXFetch(async()=>{passiveCalls++;return Response.json({});},()=>({}));
  assert.equal((await passive('https://rpc.mainnet.chain.robinhood.com/')).status,200);assert.equal(passiveCalls,1);
  checks.push({name:'Passive RPC pricing never enters 0x coordination',redisCalls:0,pass:true});
  const allAdmitted=[...events,...workerResults.flatMap(x=>x.events)].filter(x=>x.decision==='admitted').map(x=>Number(x.atMs)).sort((a,b)=>a-b);
  const maxRolling=Math.max(...allAdmitted.map(t=>allAdmitted.filter(x=>x>=t&&x<t+POLICY.windowMs).length));assert(maxRolling<=3);
  const report={at:new Date().toISOString(),result:'PASS',coordinator:real?'Real isolated Upstash Redis over TLS':'Real Redis server through test-only REST bridge',syntheticProvider:true,realZeroXRequests:0,walletSignatures:0,fundedTrades:0,policy:POLICY,checks,sharedRollingMaximum:maxRolling,admittedAtMs:allAdmitted,workerResults,events};
  const output=process.env.TASK121_QUOTA_REPORT??'task120-artifact/SHARED_QUOTA_ACCEPTANCE.json';fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,checks:checks.length,sharedRollingMaximum:maxRolling,realZeroXRequests:0,coordinator:report.coordinator}));
 } finally {bridge?.close();}
}
