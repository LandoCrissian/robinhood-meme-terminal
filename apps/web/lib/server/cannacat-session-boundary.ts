import { getAddress } from 'viem';
import { allowedKeys, validateCannaCatEmbedBody, type CannaCatOperation } from './cannacat-intent';
import { assertWalletOrigin, requireWalletSession, sessionRedis, WalletSessionError, walletSessionErrorResponse } from './wallet-session';
import { hasExactVNextZeroXOnlyPublicExecutionProviderScope } from './vnext-public-execution-provider-scope';
import { readBoundedSettlementJson } from './vnext-settlement-trace-client';
type Handler = (request: Request) => Promise<Response>;
const RATE = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n`;
export async function handleCannaCatSessionRequest(request: Request, operation: string, handlers: Record<CannaCatOperation, Handler>) {
  try {
    assertWalletOrigin(request);
    if (!Object.hasOwn(allowedKeys, operation)) return Response.json({ code: 'EMBED_OPERATION_NOT_SUPPORTED' }, { status: 404 });
    if (!hasExactVNextZeroXOnlyPublicExecutionProviderScope(process.env)) throw new WalletSessionError('EMBED_PROVIDER_RELEASE_NOT_ADMITTED', 503);
    const selected = operation as CannaCatOperation;
    const input: unknown = await readBoundedSettlementJson(request, 64 * 1024);
    if (!validateCannaCatEmbedBody(selected, input)) return Response.json({ code: 'EMBED_INVALID_INTENT' }, { status: 400 });
    const wallet = getAddress(String(selected === 'native-settlement-trace' ? input.wallet : input.recipient));
    const identity = await requireWalletSession(request, wallet);
    // Shared authenticated request limit, separate from the frozen application-wide 0x quota.
    const count = await sessionRedis(process.env)(['EVAL', RATE, 1, 'rmt:{wallet-auth-v1}:requests:' + identity.identityId, 60]);
    if (typeof count !== 'number' || count > 60) throw new WalletSessionError('WALLET_AUTH_RATE_LIMITED', 429);
    const response = await handlers[selected](new Request(request.url, { method: 'POST', headers: request.headers,
      body: JSON.stringify(input), signal: request.signal }));
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'private, no-store'); headers.set('Netlify-CDN-Cache-Control', 'no-store');
    headers.set('Vary', 'Origin, Cookie'); headers.delete('Access-Control-Allow-Origin'); headers.delete('Set-Cookie');
    return new Response(response.body, { status: response.status, headers });
  } catch (error) { return walletSessionErrorResponse(error); }
}
