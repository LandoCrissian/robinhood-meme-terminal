import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { verifyExternalSushiMarket } from "../../../../lib/server/external-sushi-market";
import { quoteSushiRoute, sushiQuotesEnabled } from "../../../../lib/server/sushi-trade";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  token: z.string().refine(isAddress),
  pair: z.string().refine(isAddress),
  recipient: z.string().refine(isAddress),
  side: z.enum(["buy", "sell"]),
  amountIn: z.string().regex(/^\d+$/)
});

const publicTradeErrors = new Set([
  "Sushi quote discovery is not enabled.",
  "Trade amount is outside the supported range.",
  "A valid wallet recipient is required.",
  "Market verification timed out.",
  "Market verification is unavailable.",
  "Market verification returned invalid data.",
  "This Sushi pool is no longer verified.",
  "This Sushi pool is no longer eligible for an RMT quote.",
  "Sushi quote discovery timed out.",
  "Sushi quote discovery is unavailable.",
  "Sushi returned an invalid quote response.",
  "Sushi returned an invalid price impact.",
  "Sushi returned invalid token metadata.",
  "Sushi returned token metadata for a different route.",
  "Sushi returned incomplete token metadata.",
  "Sushi does not have a route for this trade yet.",
  "Sushi cannot fill the complete trade amount.",
  "Sushi returned a quote for a different input amount.",
  "Sushi returned an invalid quote amount."
]);

export async function POST(request: Request) {
  try {
    if (!sushiQuotesEnabled()) {
      return Response.json(
        { error: "Sushi quote discovery is not enabled." },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid external Sushi quote request." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    const token = getAddress(parsed.data.token);
    const pair = getAddress(parsed.data.pair);
    const recipient = getAddress(parsed.data.recipient);
    const market = await verifyExternalSushiMarket({ token, pair });
    const quote = await quoteSushiRoute({
      token,
      recipient,
      side: parsed.data.side,
      amountIn: BigInt(parsed.data.amountIn)
    }, {
      chainId: 4663,
      requireTokenMetadata: true
    });

    return Response.json({
      ...quote,
      marketPair: market.pair,
      marketVerified: true
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error && publicTradeErrors.has(cause.message)
      ? cause.message
      : "Unable to verify this Sushi market and route.";
    return Response.json(
      { error: message },
      { status: 422, headers: { "Cache-Control": "no-store" } }
    );
  }
}
