import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { quoteAndBuildExternalUniswapSwap } from "../../../../lib/server/external-uniswap-trade";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  token: z.string().refine(isAddress),
  pair: z.string().refine(isAddress),
  recipient: z.string().refine(isAddress),
  side: z.enum(["buy", "sell"]),
  amountIn: z.string().regex(/^\d+$/)
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
  "The Uniswap quote is too small to enforce a safe minimum received."
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
    const result = await quoteAndBuildExternalUniswapSwap({
      token: getAddress(parsed.data.token),
      pair: getAddress(parsed.data.pair),
      recipient: getAddress(parsed.data.recipient),
      side: parsed.data.side,
      amountIn: BigInt(parsed.data.amountIn)
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error && publicErrors.has(cause.message)
      ? cause.message
      : "Unable to prepare the verified Uniswap trade.";
    return Response.json({ error: message }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}
