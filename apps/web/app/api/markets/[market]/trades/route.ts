import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { sharedCacheHeaders } from "../../../../../lib/server/cache-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const integerString = z.string().regex(/^\d+$/);
const addressString = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hashString = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const indexedTradeResponse = z.object({
  market: addressString,
  token: addressString,
  trades: z.array(z.object({
    transactionHash: hashString,
    logIndex: z.number().int().nonnegative(),
    trader: addressString,
    recipient: addressString,
    isBuy: z.boolean(),
    tokenAmount: integerString,
    ethAmount: integerString,
    feeAmount: integerString,
    virtualEthReserve: integerString,
    virtualTokenReserve: integerString,
    realEthReserve: integerString,
    blockNumber: integerString
  }).strict()).max(50),
  indexedThrough: integerString,
  confirmationDepth: z.number().int().nonnegative(),
  syncedAt: z.string().datetime().nullable()
}).strict();

function unavailable(message: string, status = 503) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": "5"
      }
    }
  );
}

function indexerBaseUrl() {
  const configured = process.env.RMT_INDEXER_URL?.trim();
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function timeoutMs() {
  const configured = Number.parseInt(process.env.RMT_INDEXER_TIMEOUT_MS ?? "5000", 10);
  return Number.isSafeInteger(configured) ? Math.min(15_000, Math.max(1_000, configured)) : 5_000;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ market: string }> }
) {
  const { market: rawMarket } = await context.params;
  if (!isAddress(rawMarket)) return unavailable("Invalid market address.", 400);

  const baseUrl = indexerBaseUrl();
  if (!baseUrl) return unavailable("Indexed market data is not configured.");

  const requested = Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "12", 10);
  const limit = Number.isSafeInteger(requested) ? Math.min(50, Math.max(1, requested)) : 12;
  const market = getAddress(rawMarket).toLowerCase();
  const headers: Record<string, string> = { Accept: "application/json" };
  const readToken = process.env.RMT_INDEXER_READ_TOKEN?.trim();
  if (readToken) headers.Authorization = `Bearer ${readToken}`;

  try {
    const response = await fetch(`${baseUrl}/markets/${market}/trades?limit=${limit}`, {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(timeoutMs())
    });
    if (!response.ok) {
      return unavailable(
        response.status === 404 ? "Indexed V6 market not found." : "Indexed market data is temporarily unavailable.",
        response.status === 404 ? 404 : 503
      );
    }

    const parsed = indexedTradeResponse.safeParse(await response.json());
    if (!parsed.success || parsed.data.market.toLowerCase() !== market) {
      return unavailable("Indexed market data failed validation.", 502);
    }

    return Response.json(parsed.data, {
      headers: {
        ...sharedCacheHeaders({
          sharedMaxAgeSeconds: 5,
          staleWhileRevalidateSeconds: 30
        }),
        "X-RMT-Data-Source": "indexer",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return unavailable("Indexed market data is temporarily unavailable.");
  }
}
