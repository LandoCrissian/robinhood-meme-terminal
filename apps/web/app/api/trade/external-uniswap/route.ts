import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { quoteAndBuildExternalUniswapSwap } from "../../../../lib/server/external-uniswap-trade";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "../../../../lib/server/rmt-trade-identity";
import {
  requireStockTokenExecutionEligible,
  stockTokenExecutionPolicyErrorResponse
} from "../../../../lib/server/robinhood-stock-token-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  token: z.string().refine(isAddress),
  pair: z.string().refine(isAddress),
  recipient: z.string().refine(isAddress),
  side: z.enum(["buy", "sell"]),
  amountIn: z.string().regex(/^\d+$/),
  maxPriceImpactBps: z.number().int().min(1).max(10_000).default(500)
});

const publicErrors = new Set([
  "Trade amount is outside the supported range.",
  "This Uniswap pool is no longer verified.",
  "This Uniswap pool is no longer eligible for in-RMT trading.",
  "This market is not a verified canonical Uniswap V3 token/WETH pool.",
  "Market verification timed out.",
  "Market verification is unavailable.",
  "Market verification returned invalid data.",
  "The official Uniswap execution contracts are unavailable.",
  "The token decimals are outside the supported range.",
  "The Uniswap pool returned an invalid quote.",
  "The Uniswap quote is too small to enforce a safe minimum received.",
  "The selected maximum price impact is invalid.",
  "Trade exceeds your selected maximum price impact."
]);

export async function POST(request: Request) {
  if (process.env.RMT_EXTERNAL_UNISWAP_EXECUTION_ENABLED !== "true") {
    return Response.json(
      { error: "In-RMT Uniswap execution is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid Uniswap trade request." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    const recipient = getAddress(parsed.data.recipient);
    const authorization = await requireAuthenticatedTradeWallet(request, recipient);
    await requireStockTokenExecutionEligible(parsed.data.token);
    const result = await quoteAndBuildExternalUniswapSwap({
      token: getAddress(parsed.data.token),
      pair: getAddress(parsed.data.pair),
      recipient,
      side: parsed.data.side,
      amountIn: BigInt(parsed.data.amountIn),
      maxPriceImpact: parsed.data.maxPriceImpactBps / 10_000
    });
    return Response.json({ ...result, authorization }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const identityResponse = tradeIdentityErrorResponse(cause);
    if (identityResponse) return identityResponse;
    const stockTokenResponse = stockTokenExecutionPolicyErrorResponse(cause);
    if (stockTokenResponse) return stockTokenResponse;
    const message = cause instanceof Error && publicErrors.has(cause.message)
      ? cause.message
      : "Unable to prepare the verified Uniswap trade.";
    return Response.json({ error: message }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}
