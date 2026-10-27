// Server-only SIWE authentication for the isolated CannaCat pilot.
// Redis holds authenticated ciphertext, never signatures, cookie secrets or plaintext wallets.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createPublicClient, getAddress, http, isAddress, type Address, type Hex } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { robinhoodChain } from '@rmt/shared/chains';

export const WALLET_AUTH = Object.freeze({ chainId: 4663, challengeSeconds: 300, sessionSeconds: 86400,
  cookie: '__Host-rmt-session', challengeCookie: '__Host-rmt-challenge', version: 'rmt-cannacat-embed-v1' });
const PREFIX = 'rmt:{wallet-auth-v1}:';
const token = () => randomBytes(32).toString('hex');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const validToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const equal = (a: string, b: string) => { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); };
export type WalletSession = { version: 1; wallet: Address; chainId: 4663; origin: string; csrf: string; issuedAt: number; expiresAt: number };
type Challenge = { version: 1; wallet: Address; origin: string; nonce: string; csrf: string; message: string; expiresAt: number };
type Env = Record<string, string | undefined>;
export type RedisCommand = (args: Array<string | number>) => Promise<unknown>;
type SignatureRequest = { message: string; signature: Hex; address: Address; domain: string; nonce: string; time: Date };
type Dependencies = { env?: Env; command?: RedisCommand; now?: () => number;
  verifySignature?: (input: SignatureRequest) => Promise<boolean> };
export class WalletSessionError extends Error {
  constructor(readonly code: string, readonly status = 401) { super(code); this.name = 'WalletSessionError'; }
}
const failure = (code: string, status = 401) => new WalletSessionError(code, status);
function settings(env: Env) {
  const secret = env.RMT_WALLET_SESSION_SECRET;
  const origin = env.RMT_WALLET_ORIGIN;
  if (env.RMT_WALLET_AUTH_ENABLED !== 'true' || !secret || !/^[a-f0-9]{64}$/.test(secret) || !origin) throw failure('WALLET_AUTH_UNAVAILABLE', 503);
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw failure('WALLET_AUTH_UNAVAILABLE', 503);
  return { origin, key: Buffer.from(secret, 'hex') };
}
function seal(value: unknown, key: Buffer, recordKey: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(recordKey));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
}
function unseal<T>(value: unknown, key: Buffer, recordKey: string): T {
  try {
    if (typeof value !== 'string' || value.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
    const data = Buffer.from(value, 'base64url');
    const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    cipher.setAAD(Buffer.from(recordKey)); cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8')) as T;
  } catch { throw failure('WALLET_SESSION_INVALID'); }
}
export function sessionRedis(env: Env, transport: typeof fetch = fetch): RedisCommand {
  return async args => {
    try {
      const url = new URL(env.RMT_ZEROX_QUOTA_REDIS_URL ?? '');
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.upstash.io') || url.username || url.password || url.pathname !== '/' || url.search || url.hash
        || !env.RMT_ZEROX_QUOTA_REDIS_TOKEN) throw Error();
      const response = await transport(url, { method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(2500),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.RMT_ZEROX_QUOTA_REDIS_TOKEN}` }, body: JSON.stringify(args) });
      if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 16384) throw Error();
      const data = await body(response) as { error?: unknown; result?: unknown };
      if (data.error || !Object.hasOwn(data, 'result')) throw Error();
      return data.result;
    } catch { throw failure('WALLET_AUTH_UNAVAILABLE', 503); }
  };
}
function cookie(request: Request, name: string) {
  const parts = (request.headers.get('cookie') ?? '').split(';').map(x => x.trim()).filter(x => x.startsWith(name + '='));
  if (parts.length > 1) throw failure('WALLET_SESSION_INVALID');
  const value = parts[0]?.slice(name.length + 1);
  if (value !== undefined && !validToken(value)) throw failure('WALLET_SESSION_INVALID');
  return value;
}
function cookieHeader(name: string, value: string, seconds: number) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
}
export function assertWalletOrigin(request: Request, env: Env = process.env) {
  const { origin } = settings(env);
  // Exact Origin plus non-simple header protect both direct and same-origin proxy requests.
  // No trust in forwarded host, supplied wallet headers, CORS alone, or an authenticated account label.
  if (request.headers.get('origin') !== origin || request.headers.get('x-rmt-client') !== WALLET_AUTH.version
    || request.method !== 'POST' || !/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw failure('WALLET_ORIGIN_REJECTED', 403);
  return origin;
}
async function body(request: Request | Response): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader(); if (!reader) throw failure('WALLET_AUTH_BAD_REQUEST', 400);
  let size = 0, text = ''; const decoder = new TextDecoder();
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
    if (size > 16384) throw failure('WALLET_AUTH_BAD_REQUEST', 413); text += decoder.decode(part.value, { stream: true }); }
    const result = JSON.parse(text + decoder.decode());
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error(); return result;
  } catch (error) { if (error instanceof WalletSessionError) throw error; throw failure('WALLET_AUTH_BAD_REQUEST', 400); }
  finally { void reader.cancel().catch(() => undefined); }
}
export async function verifyWalletSiweSignature(params: SignatureRequest, env: Env = process.env) {
  const client = createPublicClient({ chain: robinhoodChain, transport: http(env.RMT_RPC_URL ?? robinhoodChain.rpcUrls.default.http[0], { timeout: 8000, retryCount: 0 }) });
  if (await client.getChainId() !== 4663) throw failure('WALLET_AUTH_UNAVAILABLE', 503);
  // Official public-client verifier supports EOAs and ERC-1271 via read-only eth_call.
  // It may simulate deployless validation; it never broadcasts or deploys a contract.
  return client.verifySiweMessage(params);
}
const challengeKey = (id: string) => PREFIX + 'nonce:' + digest(id);
const sessionKey = (id: string) => PREFIX + 'session:' + digest(id);
export const CONSUME_CHALLENGE = `
if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
if redis.call('EXISTS',KEYS[2])==1 then return 0 end
redis.call('DEL',KEYS[1]); redis.call('DEL',KEYS[3])
redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[3])
redis.call('SET',KEYS[4],KEYS[2],'EX',300); return 1`;
const LOGOUT = `
local completed=redis.call('GET',KEYS[3])
if completed and string.sub(completed,1,string.len(ARGV[1]))==ARGV[1] then redis.call('DEL',completed) end
redis.call('DEL',KEYS[1],KEYS[2],KEYS[3]); return 1`;
const RATE = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n`;
function dependencies(deps: Dependencies) {
  const env = deps.env ?? process.env; const config = settings(env);
  return { env, ...config, now: deps.now ?? Date.now, command: deps.command ?? sessionRedis(env) };
}
async function readSession(request: Request, deps: Dependencies, csrf: boolean) {
  const d = dependencies(deps); assertWalletOrigin(request, d.env);
  const id = cookie(request, WALLET_AUTH.cookie); if (!id) throw failure('WALLET_SIGN_IN_REQUIRED');
  const session = unseal<WalletSession>(await d.command(['GET', sessionKey(id)]), d.key, sessionKey(id));
  if (session.version !== 1 || session.chainId !== 4663 || session.origin !== d.origin || !isAddress(session.wallet)
    || !validToken(session.csrf) || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= d.now()
    || !Number.isSafeInteger(session.issuedAt) || session.issuedAt > d.now() + 5000
    || session.expiresAt - session.issuedAt !== WALLET_AUTH.sessionSeconds * 1000) throw failure('WALLET_SESSION_EXPIRED');
  if (csrf && !equal(request.headers.get('x-rmt-csrf') ?? '', session.csrf)) throw failure('WALLET_CSRF_REJECTED', 403);
  return { ...d, id, session };
}
export async function requireWalletSession(request: Request, recipient: Address, deps: Dependencies = {}) {
  const { session, id } = await readSession(request, deps, true);
  if (session.wallet.toLowerCase() !== recipient.toLowerCase()) throw failure('WALLET_ACCOUNT_MISMATCH', 403);
  return { status: 'identity-wallet-bound' as const, wallet: getAddress(recipient), identityId: `siwe:4663:${digest(id)}` };
}
export async function walletSessionBinding(request: Request, deps: Dependencies = {}) {
  const { id, session } = await readSession(request, deps, true);
  // Opaque commitment binding, not a bearer credential. Never returned to the browser.
  return digest(`${id}|${session.wallet.toLowerCase()}|${session.origin}|4663`);
}
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store',
    'Netlify-CDN-Cache-Control': 'no-store', 'Vary': 'Origin, Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
}
function publicSession(session: WalletSession) {
  return { authenticated: true, wallet: session.wallet, chainId: session.chainId, csrfToken: session.csrf, expiresAt: session.expiresAt };
}
export function walletSessionErrorResponse(error: unknown) {
  const known = error instanceof WalletSessionError;
  return json({ code: known ? error.code : 'WALLET_AUTH_UNAVAILABLE', retryable: !known || error.status === 503 }, known ? error.status : 503);
}
export async function handleWalletAuth(request: Request, operation: string, deps: Dependencies = {}) {
  try {
    const d = dependencies(deps); assertWalletOrigin(request, d.env);
    if (!['session', 'challenge', 'verify', 'logout'].includes(operation)) return json({ code: 'WALLET_AUTH_NOT_FOUND' }, 404);
    const input = await body(request);
    if (Object.keys(input).some(x => !({ session: [], challenge: ['wallet'], verify: ['message', 'signature'], logout: [] } as Record<string, string[]>)[operation].includes(x))) throw failure('WALLET_AUTH_BAD_REQUEST', 400);
    if (operation === 'session') {
      try { return json(publicSession((await readSession(request, deps, false)).session)); }
      catch (error) { if (error instanceof WalletSessionError && error.status === 401) return json({ authenticated: false }); throw error; }
    }
    if (operation === 'logout') {
      // Logout uses exact Origin + the non-simple client header (both mandatory),
      // including during an unfinished sign-in. The completed-challenge reference
      // closes the verify/logout race before a new cookie reaches the browser.
      const sid = cookie(request, WALLET_AUTH.cookie), nonce = cookie(request, WALLET_AUTH.challengeCookie);
      const empty = PREFIX + 'unused:' + token();
      await d.command(['EVAL', LOGOUT, 3, sid ? sessionKey(sid) : empty,
        nonce ? challengeKey(nonce) : empty, nonce ? PREFIX + 'completed:' + digest(nonce) : empty, PREFIX + 'session:']);
      const response = json({ authenticated: false });
      response.headers.append('Set-Cookie', cookieHeader(WALLET_AUTH.cookie, '', 0));
      response.headers.append('Set-Cookie', cookieHeader(WALLET_AUTH.challengeCookie, '', 0));
      return response;
    }
    if (operation === 'challenge') {
      if (typeof input.wallet !== 'string' || !isAddress(input.wallet)) throw failure('WALLET_AUTH_BAD_REQUEST', 400);
      const wallet = getAddress(input.wallet);
      const hits = await d.command(['EVAL', RATE, 1, PREFIX + 'rate:' + digest(d.origin + wallet.toLowerCase()), 600]);
      if (typeof hits !== 'number' || hits > 10) throw failure('WALLET_AUTH_RATE_LIMITED', 429);
      const old = cookie(request, WALLET_AUTH.challengeCookie); if (old) await d.command(['DEL', challengeKey(old)]);
      const id = token(), nonce = token(), csrf = token(), issuedAt = d.now(), expiresAt = issuedAt + WALLET_AUTH.challengeSeconds * 1000;
      const message = createSiweMessage({ address: wallet, chainId: 4663, domain: new URL(d.origin).host, scheme: 'https', uri: `${d.origin}/mint`,
        version: '1', nonce, issuedAt: new Date(issuedAt), expirationTime: new Date(expiresAt),
        statement: 'Sign in to LAMMB CannaCat trading. This does not approve tokens, authorize a trade, or activate NFT registration.' });
      const challenge: Challenge = { version: 1, wallet, origin: d.origin, nonce, csrf, message, expiresAt };
      const result = await d.command(['SET', challengeKey(id), seal(challenge, d.key, challengeKey(id)), 'NX', 'EX', WALLET_AUTH.challengeSeconds]);
      if (result !== 'OK') throw failure('WALLET_AUTH_UNAVAILABLE', 503);
      const response = json({ message, csrfToken: csrf, expiresAt });
      response.headers.append('Set-Cookie', cookieHeader(WALLET_AUTH.challengeCookie, id, WALLET_AUTH.challengeSeconds));
      return response;
    }
    const id = cookie(request, WALLET_AUTH.challengeCookie); if (!id) throw failure('WALLET_CHALLENGE_EXPIRED');
    const key = challengeKey(id), raw = await d.command(['GET', key]);
    const challenge = unseal<Challenge>(raw, d.key, key);
    if (challenge.version !== 1 || challenge.origin !== d.origin || challenge.expiresAt <= d.now() || challenge.expiresAt > d.now() + 305000
      || input.message !== challenge.message || !isAddress(challenge.wallet) || !validToken(challenge.csrf)
      || !equal(request.headers.get('x-rmt-csrf') ?? '', challenge.csrf)) throw failure('WALLET_CHALLENGE_INVALID', 403);
    if (typeof input.signature !== 'string' || !/^0x(?:[a-f0-9]{2}){1,4096}$/i.test(input.signature)) throw failure('WALLET_SIGNATURE_INVALID', 403);
    const attempts = await d.command(['EVAL', RATE, 1, PREFIX + 'attempt:' + digest(id), WALLET_AUTH.challengeSeconds]);
    if (typeof attempts !== 'number' || attempts > 6) throw failure('WALLET_AUTH_RATE_LIMITED', 429);
    const verify = deps.verifySignature ?? (params => verifyWalletSiweSignature(params, d.env));
    if (!await verify({ message: challenge.message, signature: input.signature as Hex, address: challenge.wallet,
      domain: new URL(d.origin).host, nonce: challenge.nonce, time: new Date(d.now()) })) throw failure('WALLET_SIGNATURE_INVALID', 403);
    const sid = token(), previous = cookie(request, WALLET_AUTH.cookie);
    const sessionIssuedAt = d.now();
    const session: WalletSession = { version: 1, wallet: getAddress(challenge.wallet), chainId: 4663, origin: d.origin,
      csrf: token(), issuedAt: sessionIssuedAt, expiresAt: sessionIssuedAt + WALLET_AUTH.sessionSeconds * 1000 };
    const consumed = await d.command(['EVAL', CONSUME_CHALLENGE, 4, key, sessionKey(sid), previous ? sessionKey(previous) : PREFIX + 'unused:' + token(), PREFIX + 'completed:' + digest(id),
      raw as string, seal(session, d.key, sessionKey(sid)), WALLET_AUTH.sessionSeconds]);
    if (consumed !== 1) throw failure('WALLET_CHALLENGE_ALREADY_USED', 409);
    const response = json(publicSession(session));
    response.headers.append('Set-Cookie', cookieHeader(WALLET_AUTH.cookie, sid, WALLET_AUTH.sessionSeconds));
    response.headers.append('Set-Cookie', cookieHeader(WALLET_AUTH.challengeCookie, '', 0));
    return response;
  } catch (error) { return walletSessionErrorResponse(error); }
}
