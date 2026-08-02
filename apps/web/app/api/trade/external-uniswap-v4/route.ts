import { getAddress, isAddress, type Hex } from "viem";
import { z } from "zod";
import { isUniswapV4PoolId } from "../../../../lib/external-v4-evidence";
import { quoteAndBuildExternalUniswapV4Swap } from "../../../../lib/server/external-uniswap-v4-trade";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "../../../../lib/server/rmt-trade-identity";
import {
  requireStockTokenExecutionEligible,
  stockTokenExecutionPolicyErrorResponse
} from "../../../../lib/server/robinhood-stock-token-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  token: z.string().refine(isAddress),
  pair: z.string().refine(isUniswapV4PoolId),
  recipient: z.string().refine(isAddress),
  side: z.enum(["buy", "sell"]),
  amountIn: z.string().regex(/^\d+$/),
  maxPriceImpactBps: z.number().int().min(1).max(10_000).default(500)
});

const publicErrors = new Set([
  "Trade amount is outside the supported range.",
  "A valid wallet recipient is required.",
  "This Uniswap v4 pool is no longer eligible for RMT evidence.",
  "RMT could not prove one canonical initialization for this v4 pool.",
  "The canonical v4 initialization evidence is incomplete.",
  "The displayed token does not match the canonical v4 pool key.",
  "The canonical Uniswap v4 execution contracts or pool state are unavailable.",
  "RMT v4 execution requires a native ETH quote pool.",
  "The RMT v4 Passport did not clear this pool for execution.",
  "The Uniswap v4 pool returned an invalid quote.",
  "The v4 quote cannot enforce a valid input and minimum received.",
  "The exact Uniswap v4 wallet route did not pass simulation.",
  "The token decimals are outside the supported range.",
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
        { error: "Invalid Uniswap v4 trade request." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    const recipient = getAddress(parsed.data.recipient);
    const authorization = await requireAuthenticatedTradeWallet(request, recipient);
    await requireStockTokenExecutionEligible(parsed.data.token);
    const result = await quoteAndBuildExternalUniswapV4Swap({
      token: getAddress(parsed.data.token),
      poolId: parsed.data.pair as Hex,
      recipient,
      side: parsed.data.side,
      amountIn: BigInt(parsed.data.amountIn),
      maxPriceImpact: parsed.data.maxPriceImpactBps / 10_000
    });
    return Response.json({ ...result, authorization }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (cause) {
    const identityResponse = tradeIdentityErrorResponse(cause);
    if (identityResponse) return identityResponse;
    const stockTokenResponse = stockTokenExecutionPolicyErrorResponse(cause);
    if (stockTokenResponse) return stockTokenResponse;
    const message = cause instanceof Error && publicErrors.has(cause.message)
      ? cause.message
      : "Unable to prepare the Passport-gated Uniswap v4 trade.";
    return Response.json(
      { error: message },
      { status: 422, headers: { "Cache-Control": "no-store" } }
    );
  }
}
