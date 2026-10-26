import { createHash } from "node:crypto";
import { getAddress, isAddress, zeroAddress } from "viem";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "./rmt-trade-identity";
import { hasExactVNextZeroXOnlyPublicExecutionProviderScope } from "./vnext-public-execution-provider-scope";
import { readBoundedSettlementJson } from "./vnext-settlement-trace-client";

export const CANNACAT_EMBED_VERSION = "rmt-cannacat-embed-v1";
export const CANNACAT_ADDRESS = "0x1139d423c1706bdead91f03507f521635591ed92";
export type CannaCatOperation = "quotes" | "verify" | "authorize" | "native-settlement-trace";
type Handler = (request: Request) => Promise<Response>;
type Environment = Record<string, string | undefined>;
type Dependencies = {
  handlers: Record<CannaCatOperation, Handler>;
  authenticate?: typeof requireAuthenticatedTradeWallet;
  env?: Environment;
  now?: () => number;
};
const allowedKeys: Record<CannaCatOperation, readonly string[]> = {
  quotes: ["chainId", "inputAsset", "outputAsset", "inputAmountAtomic", "recipient"],
  verify: ["chainId", "quoteRequestId", "provider", "inputAsset", "outputAsset", "inputAmountAtomic", "protectedOutputFloorAtomic", "recipient"],
  authorize: ["chainId", "quoteRequestId", "verificationId", "provider", "inputAsset", "outputAsset", "inputAmountAtomic", "recipient", "expectedStatus", "indicativeProtectedOutputFloorAtomic", "expectedProtectedOutputAtomic", "settlementMode", "zeroXFirmQuoteCommitment"],
  "native-settlement-trace": ["txHash", "wallet"]
};
// A bounded per-instance backstop, not a distributed rate-limit guarantee.
// The deployment runbook also requires a route-level platform rate limit.
const buckets = new Map<string, { count: number; reset: number }>();
const MAX_BUCKETS = 2048;
const WINDOW_MS = 60_000;

export function allowedCannaCatOrigin(origin: string | null, env: Environment) {
  if (!origin || env.RMT_CANNACAT_EMBED_ENABLED !== "true") return false;
  const configured = (env.RMT_CANNACAT_EMBED_ORIGINS ?? "").split(",").map((value) => value.trim());
  if (!configured.length || configured.some((value) => {
    try {
      const url = new URL(value);
      return url.origin !== value || url.protocol !== "https:" || url.username !== "" || url.password !== "";
    } catch { return true; }
  })) return false;
  return configured.includes(origin);
}

function cors(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "content-type, privy-id-token, x-rmt-client",
    "Access-Control-Max-Age": "300",
    "Cache-Control": "private, no-store, max-age=0",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff"
  };
}

function error(code: string, status: number, origin?: string) {
  return Response.json({ code, error: code }, {
    status, headers: { "Cache-Control": "no-store", ...(origin ? cors(origin) : {}), ...(status === 429 ? { "Retry-After": "60" } : {}) }
  });
}

export function validateCannaCatEmbedBody(operation: CannaCatOperation, value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !allowedKeys[operation].includes(key))) return false;
  if (operation === "native-settlement-trace") {
    return Object.keys(input).length === 2 && typeof input.txHash === "string" && /^0x[0-9a-f]{64}$/i.test(input.txHash)
      && typeof input.wallet === "string" && isAddress(input.wallet, { strict: false });
  }
  if (input.chainId !== 4663 || typeof input.recipient !== "string" || !isAddress(input.recipient, { strict: false })
    || typeof input.inputAmountAtomic !== "string" || !/^[1-9][0-9]{0,77}$/.test(input.inputAmountAtomic)
    || BigInt(input.inputAmountAtomic) >= 2n ** 256n
    || typeof input.inputAsset !== "string" || typeof input.outputAsset !== "string") return false;
  const pair = [input.inputAsset.toLowerCase(), input.outputAsset.toLowerCase()];
  if (!((pair[0] === zeroAddress && pair[1] === CANNACAT_ADDRESS) || (pair[0] === CANNACAT_ADDRESS && pair[1] === zeroAddress))) return false;
  if (operation !== "quotes" && input.provider !== "zero-x-swap") return false;
  if (operation === "authorize" && input.settlementMode !== "PROVIDER_NATIVE_INPUT_FEE") return false;
  return true;
}

export async function handleCannaCatEmbedRequest(request: Request, operation: string, dependencies: Dependencies) {
  const env = dependencies.env ?? process.env;
  const origin = request.headers.get("origin");
  if (!allowedCannaCatOrigin(origin, env)) return error("EMBED_ORIGIN_NOT_ADMITTED", 403);
  if (!(operation in allowedKeys) || !Object.hasOwn(allowedKeys, operation)) return error("EMBED_OPERATION_NOT_SUPPORTED", 404, origin!);
  if (!hasExactVNextZeroXOnlyPublicExecutionProviderScope(env)) return error("EMBED_PROVIDER_RELEASE_NOT_ADMITTED", 503, origin!);
  if (request.method === "OPTIONS") {
    const method = request.headers.get("access-control-request-method");
    const headers = (request.headers.get("access-control-request-headers") ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (method !== "POST" || headers.some((value) => !["content-type", "privy-id-token", "x-rmt-client"].includes(value))) {
      return error("EMBED_PREFLIGHT_NOT_SUPPORTED", 403, origin!);
    }
    return new Response(null, { status: 204, headers: cors(origin!) });
  }
  if (request.method !== "POST") return error("EMBED_METHOD_NOT_SUPPORTED", 405, origin!);
  if (request.headers.get("x-rmt-client") !== CANNACAT_EMBED_VERSION
    || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json"
    || (request.headers.get("privy-id-token")?.length ?? 0) > 16_384) return error("EMBED_REQUEST_NOT_SUPPORTED", 400, origin!);
  try {
    const input: unknown = await readBoundedSettlementJson(request, 64 * 1024);
    const selected = operation as CannaCatOperation;
    if (!validateCannaCatEmbedBody(selected, input)) return error("EMBED_INVALID_INTENT", 400, origin!);
    const wallet = getAddress(String(selected === "native-settlement-trace" ? input.wallet : input.recipient));
    const identity = await (dependencies.authenticate ?? requireAuthenticatedTradeWallet)(request, wallet);
    const now = (dependencies.now ?? Date.now)();
    for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key);
    const key = createHash("sha256").update(`${origin}|${identity.identityId}`).digest("hex");
    const bucket = buckets.get(key) ?? { count: 0, reset: now + WINDOW_MS };
    if (bucket.count >= 60 || (!buckets.has(key) && buckets.size >= MAX_BUCKETS)) return error("EMBED_RATE_LIMITED", 429, origin!);
    bucket.count += 1;
    buckets.set(key, bucket);
    // Delegate directly to canonical VNext handlers. No proxy to arbitrary URLs,
    // alternate identity, fee implementation, provider or execution path.
    const delegated = new Request(request.url, {
      method: "POST", headers: { "content-type": "application/json", "privy-id-token": request.headers.get("privy-id-token") ?? "" },
      body: JSON.stringify(input), signal: request.signal
    });
    const response = await dependencies.handlers[selected](delegated);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors(origin!))) headers.set(key, value);
    headers.delete("set-cookie");
    return new Response(response.body, { status: response.status, headers });
  } catch (cause) {
    const response = tradeIdentityErrorResponse(cause);
    if (response) {
      for (const [key, value] of Object.entries(cors(origin!))) response.headers.set(key, value);
      return response;
    }
    return error("EMBED_REQUEST_FAILED", 400, origin!);
  }
}
