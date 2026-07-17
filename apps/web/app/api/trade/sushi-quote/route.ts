import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { quoteSushiRoute, sushiQuotesEnabled } from "../../../../lib/server/sushi-trade";
import { verifyActiveV6LaunchIdentity } from "../../../../lib/server/rmt-trade-identity";

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
  "Sushi quotes are available only on Robinhood Chain mainnet.",
  "Sushi quote discovery is not enabled.",
  "Trade amount is outside the supported range.",
  "The active V6 factory could not be verified.",
  "This token is not the requested active V6 launch.",
  "Sushi quote discovery timed out.",
  "Sushi quote discovery is unavailable.",
  "Sushi returned an invalid quote response.",
  "Sushi returned an invalid price impact.",
  "Sushi does not have a route for this trade yet.",
  "Sushi cannot fill the complete trade amount.",
  "Sushi returned a quote for a different input amount.",
  "Sushi returned an invalid quote amount."
]);

export async function POST(request: Request) {
  try {
    if (!sushiQuotesEnabled()) return Response.json({ error: "Sushi quote discovery is not enabled." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Invalid Sushi quote request." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const params = parsed.data;
    const token = getAddress(params.token);
    await verifyActiveV6LaunchIdentity({ launchId: BigInt(params.launchId), token });
    const result = await quoteSushiRoute({
      token,
      recipient: getAddress(params.recipient),
      side: params.side,
      amountIn: BigInt(params.amountIn)
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error && publicTradeErrors.has(cause.message)
      ? cause.message
      : "Unable to read the Sushi route.";
    return Response.json({ error: message }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}

