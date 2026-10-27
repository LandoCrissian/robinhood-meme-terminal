import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const artifact = path.join(repo, 'task120-artifact');
// Ephemeral verification-only test configuration. No production identity key,
// provider credential, wallet, JWT or signing method is used or persisted.
process.env.RMT_CANNACAT_EMBED_ENABLED = 'true';
process.env.RMT_CANNACAT_EMBED_ORIGINS = 'https://task115-embedded--lammb.netlify.app';
process.env.RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS = 'zero-x-swap';
process.env.RMT_ZEROX_API_KEY = 'synthetic-test-only';
process.env.RMT_VNEXT_VERIFICATION_COMMITMENT_SECRET = 'synthetic-commitment-test-only';
process.env.RMT_VNEXT_ZEROX_OBSERVATION_ENABLED = 'true';
process.env.RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED = 'true';
process.env.RMT_VNEXT_AUTHORIZATION_ENABLED = 'true';
process.env.NEXT_PUBLIC_PRIVY_APP_ID = 'synthetic-task120';
process.env.PRIVY_VERIFICATION_KEY = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
const { default: handler, config } = await import(pathToFileURL(path.join(artifact, 'source-functions/cannacat.mjs')));
const origin = process.env.RMT_CANNACAT_EMBED_ORIGINS;
const wallet = '0x0000000000000000000000000000000000000001';
const token = '0x1139d423C1706BDeaD91f03507F521635591eD92';
const buy = { chainId: 4663, inputAsset: '0x0000000000000000000000000000000000000000', outputAsset: token, inputAmountAtomic: '1000000000000', recipient: wallet };
const checks = [];
async function check(name, operation, expected, { method = 'POST', body = buy, headers = {}, published = false } = {}) {
  const request = new Request(`https://pilot.invalid/api/embed/cannacat/${operation}`, { method, headers: { origin, 'content-type': 'application/json', 'x-rmt-client': 'rmt-cannacat-embed-v1', ...headers }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
  const response = await handler(request, { deploy: { published }, params: { operation } });
  assert.equal(response.status, expected, name);
  assert(!response.headers.get('set-cookie'), name + ': cookie leaked');
  if (expected === 403) assert.equal(response.headers.get('access-control-allow-origin'), null);
  checks.push({ name, operation, status: response.status, expected, passed: true });
}
assert.deepEqual(config.rateLimit, { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowLimit: 120, windowSize: 60 });
for (const operation of ['quotes', 'verify', 'authorize', 'native-settlement-trace']) {
  await check('Exact-origin preflight', operation, 204, { method: 'OPTIONS', headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,privy-id-token,x-rmt-client' } });
  const body = operation === 'native-settlement-trace' ? { wallet, txHash: '0x3c5b142f2fcf2bad01a154b1b84754bd4e4c32281aa14c06641fa70f2221a522' } : operation === 'quotes' ? buy : { ...buy, provider: 'zero-x-swap', ...(operation === 'authorize' ? { settlementMode: 'PROVIDER_NATIVE_INPUT_FEE' } : {}) };
  await check('No identity cannot enter canonical handler', operation, 401, { body });
  await check('Forged identity rejected', operation, 401, { body, headers: { 'privy-id-token': 'synthetic.invalid.token' } });
}
for (const untrusted of ['https://lammb.fun.attacker.invalid', 'http://lammb.fun', 'null']) await check('Untrusted origin', 'quotes', 403, { headers: { origin: untrusted } });
await check('Wrong chain', 'quotes', 400, { body: { ...buy, chainId: 1 } });
await check('Wrong token', 'quotes', 400, { body: { ...buy, outputAsset: wallet } });
await check('Unknown body field', 'quotes', 400, { body: { ...buy, arbitraryExecution: true } });
await check('Unsupported client', 'quotes', 400, { headers: { 'x-rmt-client': 'wrong-version' } });
await check('Published production refused', 'quotes', 503, { published: true });
const missingContext = await handler(new Request('https://pilot.invalid/api/embed/cannacat/quotes'), { params: { operation: 'quotes' } });
assert.equal(missingContext.status, 503);
checks.push({ name: 'Missing provider context refused', status: 503, expected: 503, passed: true });
const originalKey=process.env.RMT_ZEROX_API_KEY;delete process.env.RMT_ZEROX_API_KEY;
await check('Incomplete runtime configuration fails closed before canonical bootstrap','quotes',503);
process.env.RMT_ZEROX_API_KEY=originalKey;
// Production opt-in is a server configuration gate, never a client request flag.
const savedOrigins=process.env.RMT_CANNACAT_EMBED_ORIGINS;
process.env.RMT_CANNACAT_PRODUCTION_PILOT_ENABLED='true';
await check('Production refuses preview origin configuration','quotes',503,{published:true});
process.env.RMT_CANNACAT_EMBED_ORIGINS='https://lammb.fun';
await check('Production refuses missing shared coordinator','quotes',503,{published:true});
process.env.RMT_ZEROX_QUOTA_REDIS_URL='https://test.upstash.io';
process.env.RMT_ZEROX_QUOTA_REDIS_TOKEN='synthetic-test-only';
await check('Explicit production configuration permits only canonical preflight','quotes',204,{method:'OPTIONS',published:true,headers:{origin:'https://lammb.fun','access-control-request-method':'POST','access-control-request-headers':'content-type,privy-id-token,x-rmt-client'}});
await check('Production configuration still requires identity','quotes',401,{published:true,headers:{origin:'https://lammb.fun'}});
delete process.env.RMT_CANNACAT_PRODUCTION_PILOT_ENABLED;
delete process.env.RMT_ZEROX_QUOTA_REDIS_URL;delete process.env.RMT_ZEROX_QUOTA_REDIS_TOKEN;
process.env.RMT_CANNACAT_EMBED_ORIGINS=savedOrigins;
const report = { result: 'PASS', tests: checks.length + 1, checks, nativeRateLimitConfigAsserted: true, nativeDistributedEnforcement: 'requires deployed test', authenticatedLiveQuote: false, fundedTrades: 0, walletSignatures: 0 };
fs.writeFileSync(path.join(artifact, 'ADAPTER_TESTS.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ result: report.result, tests: report.tests }));
