// Server-only transport admission. No wallet, quote, key or calldata is stored.
import { createHash, randomUUID } from 'node:crypto';
type Transport = typeof fetch;
type Settings = Record<string, string | undefined>;
type Event = { decision: string; kind: string; atMs?: number; waitMs?: number };
const PREFIX = 'rmt:{zero-x-app-rmt-vnext-benchmark}:quota:v1:';
const KEYS = ['events', 'lease', 'cooldown', 'priority'].map(key => PREFIX + key);
// Completion-based sliding window is conservative even if network transit varies.
// A lost response keeps its reservation for the full lease, then another window.
export const POLICY = Object.freeze({ limit: 3, windowMs: 1100, priceLimit: 2, leaseMs: 6500, admissionAttempts: 3 });
export const ADMIT = `
local t=redis.call('TIME'); local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
local cooldown=tonumber(redis.call('GET',KEYS[3]) or '0')
if cooldown>now then return {0,now,cooldown-now,1} end
local lease=redis.call('PTTL',KEYS[2]); if lease>0 then
 if ARGV[2]=='quote' then redis.call('SET',KEYS[4],'1','PX',750) end
 return {0,now,lease,2}
end
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now-tonumber(ARGV[3]))
local entries=redis.call('ZRANGE',KEYS[1],0,-1,'WITHSCORES')
local count=#entries/2; local prices=0
for i=1,#entries,2 do if string.sub(entries[i],1,2)=='p:' then prices=prices+1 end end
if ARGV[2]=='price' and redis.call('EXISTS',KEYS[4])==1 then return {0,now,750,3} end
if count>=tonumber(ARGV[4]) or (ARGV[2]=='price' and prices>=tonumber(ARGV[5])) then
 if ARGV[2]=='quote' then redis.call('SET',KEYS[4],'1','PX',750) end
 local wait=tonumber(entries[2])+tonumber(ARGV[3])-now
 return {0,now,math.max(1,wait),4}
end
redis.call('SET',KEYS[2],ARGV[1],'PX',ARGV[6])
redis.call('ZADD',KEYS[1],now+tonumber(ARGV[6]),ARGV[1])
redis.call('PEXPIRE',KEYS[1],tonumber(ARGV[6])+tonumber(ARGV[3])+1000)
if ARGV[2]=='quote' then redis.call('DEL',KEYS[4]) end
return {1,now,0,0}`;
export const COMPLETE = `
local t=redis.call('TIME'); local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
if redis.call('GET',KEYS[2])~=ARGV[1] then return {0,now} end
redis.call('ZADD',KEYS[1],now,ARGV[1]); redis.call('PEXPIRE',KEYS[1],10000)
local delay=tonumber(ARGV[2]); local old=tonumber(redis.call('GET',KEYS[3]) or '0')
if delay>0 and now+delay>old then redis.call('SET',KEYS[3],now+delay,'PX',delay) end
redis.call('DEL',KEYS[2]); return {1,now}`;

function fail(status: number, code: string, retryMs = 1000) {
 return Response.json({code}, {status, headers:{'Cache-Control':'no-store','Retry-After':String(Math.max(1,Math.ceil(retryMs/1000))),'X-RMT-Quota-Decision':code}});
}
function retryMs(response: Response) {
 const raw=response.headers.get('retry-after');
 const seconds=Number(raw);
 if(raw && Number.isFinite(seconds) && seconds>0) return Math.ceil(seconds*1000);
 const date=raw ? Date.parse(raw) : NaN;
 return Number.isFinite(date) ? Math.max(1000,date-Date.now()) : 1000;
}
export function createSharedZeroXFetch(transport: Transport, settings: () => Settings, emit: (event: Event) => void = () => {}) : Transport {
 const identicalPrices=new Map<string,Promise<Response>>(); // Coalescing only; never admission authority.
 async function command(script: string, args: string[]) {
  const env=settings(), endpoint=env.RMT_ZEROX_QUOTA_REDIS_URL, token=env.RMT_ZEROX_QUOTA_REDIS_TOKEN;
  if(!endpoint || !token) throw Error('QUOTA_COORDINATION_UNAVAILABLE');
  const parsed=new URL(endpoint);
  if(parsed.protocol!=='https:' || !parsed.hostname.endsWith('.upstash.io') || parsed.username || parsed.password || parsed.search || parsed.pathname!=='/') throw Error('QUOTA_COORDINATION_UNAVAILABLE');
  const response=await transport(endpoint,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(['EVAL',script,String(KEYS.length),...KEYS,...args]),redirect:'error',signal:AbortSignal.timeout(900)});
  if(!response.ok)throw Error('QUOTA_COORDINATION_UNAVAILABLE');
  const body=await response.json() as {error?:unknown;result?:unknown};
  if(body.error || !Array.isArray(body.result) || !body.result.every(x=>typeof x==='number'&&Number.isFinite(x)))throw Error('QUOTA_COORDINATION_UNAVAILABLE');
  return body.result as number[];
 }
 async function run(input: Parameters<Transport>[0], init: Parameters<Transport>[1], kind: string) {
  const signal=init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const id=(kind==='price'?'p:':'q:')+randomUUID();
  let admitted=false;
  try {
   let result:number[]=[];
   for(let attempt=0;attempt<POLICY.admissionAttempts;attempt++) {
    signal?.throwIfAborted();
    result=await command(ADMIT,[id,kind,String(POLICY.windowMs),String(POLICY.limit),String(POLICY.priceLimit),String(POLICY.leaseMs)]);
    if(result.length!==4||![0,1].includes(result[0])||result[1]<=0||result[2]<0)throw Error('QUOTA_COORDINATION_UNAVAILABLE');
    if(result[0]===1){admitted=true;emit({decision:'admitted',kind,atMs:result[1]});break;}
    if(result[0]!==0||result.length!==4)throw Error('QUOTA_COORDINATION_UNAVAILABLE');
    if(attempt===POLICY.admissionAttempts-1||result[3]===1)break;
    const wait=Math.min(250,Math.max(75,result[2]));
    await new Promise<void>((resolve,reject)=>{function abort(){clearTimeout(timer);reject(Error('ABORTED'));}const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},wait);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
   }
   if(!admitted){emit({decision:'limited',kind,atMs:result[1],waitMs:result[2]});return fail(429,'SHARED_QUOTA_LIMITED',result[2]);}
   signal?.throwIfAborted();
   // Every physical attempt consumes a permit. Never retry provider requests here.
   const deadline=AbortSignal.timeout(4000);
   const response=await transport(input,{...init,redirect:'error',signal:signal?AbortSignal.any([signal,deadline]):deadline});
   const completed=await command(COMPLETE,[id,String(response.status===429?retryMs(response):0)]);
   if(completed[0]!==1)throw Error('QUOTA_COORDINATION_UNAVAILABLE');
   admitted=false;
   emit({decision:response.status===429?'provider_429':'completed',kind,atMs:completed[1]});
   return response;
  } catch {
   if(admitted) {try {await command(COMPLETE,[id,'1000']);}catch {/* Lease remains reserved. No process-local fallback. */}}
   emit({decision:'unavailable',kind});
   return fail(503,'QUOTA_COORDINATION_UNAVAILABLE');
  }
 }
 return async (input,init) => {
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(url.hostname!=='api.0x.org')return transport(input,init);
  const kind=url.pathname.endsWith('/price')?'price':'quote';
  const method=init?.method ?? (input instanceof Request?input.method:'GET');
  if(kind!=='price'||method!=='GET')return run(input,init,kind);
  const headers=new Headers(init?.headers ?? (input instanceof Request?input.headers:undefined));
  const pairs:Array<[string,string]>=[];headers.forEach((value,key)=>pairs.push([key,value]));
  const identity=createHash('sha256').update(url.href+'\n'+JSON.stringify(pairs.sort())).digest('hex');
  let request=identicalPrices.get(identity);
  if(!request){request=run(input,init,kind);if(identicalPrices.size<128){identicalPrices.set(identity,request);void request.finally(()=>identicalPrices.delete(identity)).catch(()=>undefined);}}
  else emit({decision:'coalesced',kind});
  return (await request).clone();
 };
}
