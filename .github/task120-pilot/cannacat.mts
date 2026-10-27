// Hosting adapter only. The four canonical handlers remain frozen and unchanged.
import { performance } from 'node:perf_hooks';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export const config = {
  path: '/api/embed/cannacat/:operation',
  method: ['POST', 'OPTIONS'],
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowLimit: 120, windowSize: 60 },
};

const environmentKeys = [
  'NEXT_PUBLIC_PRIVY_APP_ID', 'PRIVY_VERIFICATION_KEY', 'NEXT_PUBLIC_RMT_NETWORK',
  'NEXT_PUBLIC_RMT_RPC_URL', 'RMT_RPC_URL', 'RMT_MAINNET_RPC_URL', 'ROBINHOOD_MAINNET_RPC_URL',
  'RMT_SETTLEMENT_TRACE_RPC_URL', 'RMT_ZEROX_API_KEY', 'RMT_ZEROX_ALLOWANCE_HOLDER',
  'RMT_VNEXT_AUTHORIZATION_ENABLED', 'RMT_VNEXT_ZEROX_OBSERVATION_ENABLED',
  'RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED', 'RMT_VNEXT_VERIFICATION_COMMITMENT_SECRET',
  'RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS', 'RMT_CANNACAT_EMBED_ENABLED', 'RMT_CANNACAT_EMBED_ORIGINS',
];
let canonical: Promise<typeof import('./canonical.mts')> | undefined;
let cold = true;
type Observation = { requestId: string; operation: string; provider: Array<{status: number; kind: string; requestId?: string; retrySeconds?: number; resultCode?: string; liquidityAvailable?: boolean; balanceIssue?: boolean; simulationIncomplete?: boolean}> };
const observation = new AsyncLocalStorage<Observation>();
const originalFetch = globalThis.fetch;
// Inspect a bounded clone for enumerated diagnostics only. Never log bodies,
// wallets, amounts, calldata, quote commitments, secrets or provider text.
async function structuredResult(response: Response): Promise<Record<string, any> | null> {
  if (!response.headers.get('content-type')?.includes('application/json') || Number(response.headers.get('content-length') ?? 0) > 1_048_576) return null;
  const reader=response.clone().body?.getReader(); if (!reader) return null;
  let bytes=0,text='';const decoder=new TextDecoder();
  try { while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1_048_576)return null;text+=decoder.decode(part.value,{stream:true});}
    const value=JSON.parse(text+decoder.decode());return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
  } catch { return null; } finally { void reader.cancel().catch(()=>undefined); }
}
const diagnosticCode=(value:unknown) => typeof value==='string'&&/^[A-Z][A-Z0-9_]{1,99}$/.test(value)?value:undefined;
const businessStates=new Set(['verified','approval_required','approval_simulation_failed','insufficient_balance','insufficient_gas','gas_unavailable','simulation_failed']);
// Hosting telemetry only. Do not serialize URLs, keys, accounts or provider bodies.
globalThis.fetch = async (input, init) => {
  const active = observation.getStore();
  if (!active) return originalFetch(input, init);
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname !== 'api.0x.org') return originalFetch(input, init);
  const kind = url.pathname.endsWith('/price') ? 'price' : url.pathname.endsWith('/quote') ? 'quote' : 'other';
  try {
    const response = await originalFetch(input, init);
    const rawId = response.headers.get('0x-request-id') ?? response.headers.get('x-request-id');
    const requestId = rawId && /^[A-Za-z0-9_-]{8,100}$/.test(rawId) ? rawId : undefined;
    const retry = Number(response.headers.get('retry-after'));
    const details=await structuredResult(response);
    active.provider.push({kind,status:response.status,...(requestId ? {requestId}:{}),
      ...(response.status === 429 ? {retrySeconds:Number.isFinite(retry)&&retry>0?Math.ceil(retry):1}:{}),
      ...(diagnosticCode(details?.name)?{resultCode:diagnosticCode(details?.name)}:{}),
      ...(typeof details?.liquidityAvailable==='boolean'?{liquidityAvailable:details.liquidityAvailable}:{}),
      ...(details?.issues&&typeof details.issues==='object'?{balanceIssue:!!details.issues.balance,simulationIncomplete:details.issues.simulationIncomplete===true}:{})});
    return response;
  } catch (error) {
    active.provider.push({kind,status:0}); throw error;
  }
};

function environment(): Record<string,string|undefined> {
  const netlify = (globalThis as any).Netlify;
  return Object.fromEntries(environmentKeys.map(key => [key, netlify?.env?.get?.(key) ?? process.env[key]]));
}

function configured(values: Record<string,string|undefined>) {
  return Boolean(values.RMT_ZEROX_API_KEY?.trim() && values.RMT_VNEXT_VERIFICATION_COMMITMENT_SECRET?.trim()
    && values.NEXT_PUBLIC_PRIVY_APP_ID?.trim() && values.PRIVY_VERIFICATION_KEY?.includes('BEGIN PUBLIC KEY')
    && values.RMT_VNEXT_ZEROX_OBSERVATION_ENABLED === 'true'
    && values.RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED === 'true'
    && values.RMT_VNEXT_AUTHORIZATION_ENABLED === 'true'
    && values.RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS === 'zero-x-swap');
}

function loadCanonical(values: Record<string,string|undefined>) {
  if (!canonical) {
    // Modern Netlify runtime bindings are copied once, before module-level policy
    // initialization. No request, wallet or identity is written into process.env.
    for (const [key,value] of Object.entries(values)) if (value !== undefined) process.env[key] = value;
    canonical = import('./canonical.mts').catch((error) => { canonical = undefined; throw error; });
  }
  return canonical;
}

export default async function handler(request: Request, context: { requestId?: string; deploy?: { published?: boolean }; params?: { operation?: string } }) {
  const started = performance.now();
  const wasCold = cold;
  cold = false;
  // This artifact cannot serve a published production deployment.
  if (context.deploy?.published !== false) {
    return Response.json({ code: 'PILOT_PREVIEW_ONLY' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const requestedOperation = context.params?.operation ?? '';
  const active: Observation = {requestId: context.requestId ?? randomUUID(),operation:['quotes','verify','authorize','native-settlement-trace'].includes(requestedOperation)?requestedOperation:'unsupported',provider:[]};
  return observation.run(active, async () => {
   try {
    const values = environment();
    // Do not initialize/cache the canonical provider registry with missing configuration.
    if (!configured(values)) {
      const origin = request.headers.get('origin');
      const allowed = values.RMT_CANNACAT_EMBED_ORIGINS?.split(',').map(x=>x.trim()).includes(origin ?? '');
      console.info(JSON.stringify({event:'rmt_embed_request',requestId:active.requestId,operation:active.operation,status:503,code:'PILOT_CONFIGURATION_UNAVAILABLE',providerRequests:0}));
      return Response.json({code:'PILOT_CONFIGURATION_UNAVAILABLE'}, {status:503,headers:{'Cache-Control':'no-store',
        'X-RMT-Request-Id':active.requestId,'Access-Control-Expose-Headers':'X-RMT-Request-Id,Retry-After',
        ...(allowed&&origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})}});
    }
    const { handle } = await loadCanonical(values);
    let response = await handle(request, requestedOperation);
    const headers = new Headers(response.headers);
    headers.set('Server-Timing', `rmt;dur=${(performance.now() - started).toFixed(2)}`);
    headers.set('X-RMT-Pilot-Cold-Start', String(wasCold));
    headers.set('X-RMT-Request-Id',active.requestId);
    headers.set('Access-Control-Expose-Headers','X-RMT-Request-Id,Retry-After');
    const limited = active.provider.find(x=>x.status===429);
    if (limited && (!response.ok || active.operation === 'quotes')) {
      headers.set('Retry-After',String(limited.retrySeconds ?? 1));
      response = Response.json({code:'RATE_LIMITED',stage:active.operation,retryable:true}, {status:429});
    }
    const result=await structuredResult(response);
    const resultCode=diagnosticCode(result?.code)??diagnosticCode(result?.error);
    const rawState=result?.status??result?.evidence?.status;
    const businessStatus=typeof rawState==='string'&&businessStates.has(rawState)?rawState:undefined;
    console.info(JSON.stringify({event:'rmt_embed_request',requestId:active.requestId,operation:active.operation,
      status:response.status,...(resultCode?{resultCode}:{}),...(businessStatus?{businessStatus}:{}),providerRequests:active.provider.length,provider:active.provider,coldStart:wasCold,
      durationMs:Math.round(performance.now()-started)}));
    return new Response(response.body, { status: response.status, headers });
   } catch {
    // Never serialize provider URLs, environment values, identity tokens or errors.
    console.info(JSON.stringify({event:'rmt_embed_request',requestId:active.requestId,operation:active.operation,status:503,code:'PILOT_RUNTIME_UNAVAILABLE',providerRequests:active.provider.length,provider:active.provider}));
    return Response.json({ code: 'PILOT_RUNTIME_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store','X-RMT-Request-Id':active.requestId } });
   }
  });
}
