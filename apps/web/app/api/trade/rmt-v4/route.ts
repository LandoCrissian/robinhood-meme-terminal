import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { quoteAndBuildRmtV4Swap } from "../../../../lib/server/rmt-v4-trade";
import { ROBINHOOD_UNIVERSAL_ROUTER } from "../../../../lib/uniswap-v4";
import { activeChain } from "../../../../lib/network";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  launchId: z.string().regex(/^\d+$/),
  token: z.string().refine(isAddress),
  recipient: z.string().refine(isAddress),
  side: z.enum(["buy", "sell"]),
  amountIn: z.string().regex(/^\d+$/)
});

const publicTradeErrors = new Set([
  "Native RMT Uniswap v4 trading is available only on Robinhood Chain mainnet.",
  "Trade amount is outside the supported range.",
  "A valid wallet recipient is required.",
  "The active V6 factory could not be verified.",
  "This token is not the requested active V6 launch.",
  "The canonical Uniswap v4 pool is not open yet.",
  "The graduated pool configuration failed RMT verification.",
  "The official Uniswap execution contracts are unavailable.",
  "The canonical pool returned an invalid quote.",
  "The canonical pool quote is too small to enforce a safe minimum received."
]);

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Invalid V4 trade request." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const params = parsed.data;
    const result = await quoteAndBuildRmtV4Swap({
      launchId: BigInt(params.launchId),
      token: getAddress(params.token),
      recipient: getAddress(params.recipient),
      side: params.side,
      amountIn: BigInt(params.amountIn)
    });
    return Response.json({
      chainId: activeChain.id,
      token: getAddress(params.token),
      recipient: getAddress(params.recipient),
      side: params.side,
      router: ROBINHOOD_UNIVERSAL_ROUTER,
      calldata: result.calldata,
      value: result.value.toString(),
      amountIn: params.amountIn,
      quoteOut: result.quoteOut.toString(),
      minimumOut: result.minimumOut.toString(),
      deadline: result.deadline.toString(),
      verified: true
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error && publicTradeErrors.has(cause.message)
      ? cause.message
      : "Unable to prepare the canonical Uniswap v4 trade.";
    return Response.json({ error: message }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}
