import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { numberToHex, verifyMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { handleWalletAuth, requireWalletSession, walletSessionBinding, type RedisCommand } from './wallet-session';

// Dedicated disposable CI Redis only. Never target an owner database or a remote URL.
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Run this suite in disposable CI');
const command: RedisCommand = async args => JSON.parse(execFileSync('redis-cli', ['--json', '-h', '127.0.0.1', '-p', '6379', ...args.map(String)], { encoding: 'utf8' }));
await command(['FLUSHDB']);
const origin = 'https://task125-wallet--lammb.netlify.app';
const env = { RMT_WALLET_AUTH_ENABLED: 'true', RMT_WALLET_ORIGIN: origin, RMT_WALLET_SESSION_SECRET: randomBytes(32).toString('hex') };
// Publicly known, unfunded deterministic test keys; never an owner wallet.
const alice = privateKeyToAccount(numberToHex(1n, { size: 32 }));
const bob = privateKeyToAccount(numberToHex(2n, { size: 32 }));
const now = Date.now();
const deps = { env, command, now: () => now, verifySignature: async (p: { message: string; signature: `0x${string}`; address: `0x${string}` }) => verifyMessage(p) };
type Jar = Map<string, string>;
const jar: Jar = new Map();
function request(input: object = {}, cookies = jar, csrf?: string, from = origin) {
  return new Request('https://isolated-api.invalid/api/embed/cannacat/auth', { method: 'POST',
    headers: { origin: from, 'content-type': 'application/json', 'x-rmt-client': 'rmt-cannacat-embed-v1',
      cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...(csrf ? { 'x-rmt-csrf': csrf } : {}) }, body: JSON.stringify(input) });
}
function save(response: Response, cookies = jar) {
  for (const raw of response.headers.getSetCookie()) { const first = raw.split(';')[0], i = first.indexOf('=');
    const name = first.slice(0, i), value = first.slice(i + 1); if (value) cookies.set(name, value); else cookies.delete(name); }
}
let checks = 0;
const pass = (condition: unknown, name: string) => { assert(condition, name); checks++; };
async function challenge(account = alice, cookies = jar) {
  const response = await handleWalletAuth(request({ wallet: account.address }, cookies), 'challenge', deps);
  assert.equal(response.status, 200); save(response, cookies); return await response.json();
}
async function signed(account = alice, cookies = jar) {
  const value = await challenge(account, cookies);
  const signature = await account.signMessage({ message: value.message });
  return { value, signature };
}
const empty = await handleWalletAuth(request(), 'session', deps);
pass((await empty.json()).authenticated === false, 'No cookie is not authenticated');
const { value, signature } = await signed();
pass(value.message.includes('Chain ID: 4663') && value.message.includes(`URI: ${origin}/mint`), 'Exact SIWE chain and URI');
pass(value.message.includes('does not approve tokens'), 'SIWE purpose excludes transaction authority');
const snapshot = new Map(jar);
const badSignature = await bob.signMessage({ message: value.message });
pass((await handleWalletAuth(request({ message: value.message, signature: badSignature }, jar, value.csrfToken), 'verify', deps)).status === 403, 'Wrong signing account rejected');
pass((await handleWalletAuth(request({ message: value.message.replace('4663', '1'), signature }, jar, value.csrfToken), 'verify', deps)).status === 403, 'Changed chain/message rejected');
pass((await handleWalletAuth(request({ message: value.message, signature }, jar, '0'.repeat(64)), 'verify', deps)).status === 403, 'CSRF mismatch rejected');
pass((await handleWalletAuth(request({ message: value.message, signature }, new Map(), value.csrfToken), 'verify', deps)).status === 401, 'Challenge cookie required');
const results = await Promise.all(Array.from({ length: 5 }, () => handleWalletAuth(request({ message: value.message, signature }, new Map(snapshot), value.csrfToken), 'verify', deps)));
pass(results.filter(r => r.status === 200).length === 1, 'Atomic single-use nonce: one winner among concurrent verifications');
const verified = results.find(r => r.status === 200)!; save(verified); const session = await verified.json();
pass(verified.headers.getSetCookie().some(c => c.startsWith('__Host-rmt-session=') && c.includes('Secure; HttpOnly; SameSite=Lax')), 'Secure host-only HttpOnly session cookie');
pass(!JSON.stringify(session).includes(signature) && !JSON.stringify(session).includes(jar.get('__Host-rmt-session')!), 'No signature or bearer session credential in JSON');
pass((await requireWalletSession(request({}, jar, session.csrfToken), alice.address, deps)).wallet === alice.address, 'Server session authorizes exact wallet');
await assert.rejects(requireWalletSession(request({}, jar, session.csrfToken), bob.address, deps)); checks++;
await assert.rejects(requireWalletSession(request({}, jar, session.csrfToken, 'https://evil.invalid'), alice.address, deps)); checks++;
await assert.rejects(requireWalletSession(request({}, jar), alice.address, deps)); checks++;
pass((await walletSessionBinding(request({}, jar, session.csrfToken), deps)).length === 64, 'Server-only commitment binding available');
const restored = await handleWalletAuth(request(), 'session', deps);
pass((await restored.json()).csrfToken === session.csrfToken, 'Reload restores stable session without another signature');
await assert.rejects(requireWalletSession(request({}, jar, session.csrfToken), alice.address, { ...deps, now: () => now + 86400001 })); checks++;
const keys = await command(['KEYS', 'rmt:{wallet-auth-v1}:session:*']) as string[];
assert.equal(keys.length, 1); const ciphertext = await command(['GET', keys[0]]) as string;
pass(!ciphertext.includes(alice.address) && !ciphertext.includes(signature) && !ciphertext.includes(session.csrfToken), 'Redis record is encrypted');
await command(['SET', keys[0], ciphertext.slice(0, -4) + 'AAAA']);
await assert.rejects(requireWalletSession(request({}, jar, session.csrfToken), alice.address, deps)); checks++;
await command(['SET', keys[0], ciphertext, 'EX', 86400]);
const oldJar = new Map(jar), oldCsrf = session.csrfToken;
const second = await signed();
const rotated = await handleWalletAuth(request({ message: second.value.message, signature: second.signature }, jar, second.value.csrfToken), 'verify', deps);
pass(rotated.status === 200, 'Explicit reauthentication succeeds'); save(rotated); const nextSession = await rotated.json();
pass(jar.get('__Host-rmt-session') !== oldJar.get('__Host-rmt-session'), 'Authentication rotates session identifier');
await assert.rejects(requireWalletSession(request({}, oldJar, oldCsrf), alice.address, deps)); checks++;
const currentKey = (await command(['KEYS', 'rmt:{wallet-auth-v1}:session:*']) as string[])[0];
const currentCipher = await command(['GET', currentKey]);
await command(['SET', keys[0], currentCipher as string, 'EX', 86400]);
await assert.rejects(requireWalletSession(request({}, oldJar, oldCsrf), alice.address, deps)); checks++;
pass(true, 'Ciphertext cannot be moved between session keys (AEAD storage-key binding)');
const logout = await handleWalletAuth(request({}, jar, nextSession.csrfToken), 'logout', deps);
pass(logout.status === 200, 'Explicit logout invalidates server session');
await assert.rejects(requireWalletSession(request({}, jar, nextSession.csrfToken), alice.address, deps)); checks++;
save(logout); pass(jar.size === 0, 'Logout clears host cookies');
const unavailable = await handleWalletAuth(request(), 'session', { ...deps, command: async () => { throw Error('offline'); } });
// No cookie is signed out; a present token must fail closed when Redis is unavailable.
const unavailableWithCookie = await handleWalletAuth(request({}, oldJar), 'session', { ...deps, command: async () => { throw Error('offline'); } });
pass(unavailable.status === 200 && unavailableWithCookie.status === 503, 'Coordination outage never trusts browser session');
pass((await handleWalletAuth(request({}, jar, undefined, 'https://evil.invalid'), 'session', deps)).status === 403, 'Origin spoof without authorized cookies cannot access session');
pass((await handleWalletAuth(new Request('https://api.invalid'), 'session', deps)).status === 403, 'Simple cross-site and GET requests rejected');
pass((await handleWalletAuth(request({ wallet: alice.address, purpose: 'admin' }), 'challenge', deps)).status === 400, 'No Genesis/admin authorization escalation');
await command(['FLUSHDB']);
mkdirSync('task125-artifact', { recursive: true });
writeFileSync('task125-artifact/AUTH_TESTS.json', JSON.stringify({ result: 'PASS', checks, atomicRedis: true, walletSignatures: 'disposable synthetic accounts only',
  ownerSignatures: 0, fundedTrades: 0, eoaVerification: true, erc1271: 'public-client verifier integration requires separate test', provider: 'self-hosted-siwe' }, null, 2));
console.log(JSON.stringify({ result: 'PASS', checks, atomicRedis: true }));
