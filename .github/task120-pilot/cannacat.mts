// Hosting adapter only. The four canonical handlers remain frozen and unchanged.
import { performance } from 'node:perf_hooks';

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

function loadCanonical() {
  if (!canonical) {
    // Modern Netlify runtime bindings are copied once, before module-level policy
    // initialization. No request, wallet or identity is written into process.env.
    const netlify = (globalThis as any).Netlify;
    if (netlify?.env?.get) {
      for (const key of environmentKeys) {
        const value = netlify.env.get(key);
        if (value !== undefined) process.env[key] = value;
      }
    }
    canonical = import('./canonical.mts').catch((error) => { canonical = undefined; throw error; });
  }
  return canonical;
}

export default async function handler(request: Request, context: { deploy?: { published?: boolean }; params?: { operation?: string } }) {
  const started = performance.now();
  const wasCold = cold;
  cold = false;
  // This artifact cannot serve a published production deployment.
  if (context.deploy?.published !== false) {
    return Response.json({ code: 'PILOT_PREVIEW_ONLY' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const { handle } = await loadCanonical();
    const response = await handle(request, context.params?.operation ?? '');
    const headers = new Headers(response.headers);
    headers.set('Server-Timing', `rmt;dur=${(performance.now() - started).toFixed(2)}`);
    headers.set('X-RMT-Pilot-Cold-Start', String(wasCold));
    return new Response(response.body, { status: response.status, headers });
  } catch {
    // Never serialize provider URLs, environment values, identity tokens or errors.
    return Response.json({ code: 'PILOT_RUNTIME_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
