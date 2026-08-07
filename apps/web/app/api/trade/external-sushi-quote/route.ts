import { getAddress, isAddress } from "viem";
import { z } from "zod";
import {
  quoteAndBuildSushiSwap,
  quoteSushiRoute,
  sushiDeadlineGuardConfiguration,
  sushiExecutionAllowance,
  sushiQuotesEnabled,
  verifySushiDeadlineGuardConfiguration
} from "../../../../lib/server/sushi-trade";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "../../../../lib/server/rmt-trade-identity";
import {
  fetchRobinhoodStockRegistry,
  requireStockTokenExecutionEligible,
  stockTokenExecutionPolicyErrorResponse
} from "../../../../lib/server/robinhood-stock-token-registry";
import { verifyUniversalMarketPoolForToken } from "../../../../lib/server/universal-market-resolver";

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

const publicTradeErrors = new Set([
  "Sushi quote discovery is not enabled.",
  "Trade amount is outside the supported range.",
  "A valid wallet recipient is required.",
  "Market verification timed out.",
  "Market verification is unavailable.",
  "Market verification returned invalid data.",
  "This Sushi pool is no longer verified.",
  "This Sushi pool is no longer eligible for an RMT quote.",
  "This is not a canonical Robinhood Chain pool for the requested token.",
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
  "Sushi returned an invalid quote amount.",
  "Sushi execution is available only on Robinhood Chain mainnet.",
  "Sushi route construction timed out.",
  "Sushi could not construct this trade route.",
  "Sushi returned an invalid executable swap response.",
  "Sushi returned undecodable execution calldata.",
  "Sushi returned an unsupported execution function.",
  "Sushi changed the transaction sender.",
  "Sushi returned an unapproved execution router.",
  "Sushi changed the executable input amount.",
  "Sushi changed the input token.",
  "Sushi calldata changed the input amount.",
  "Sushi changed the output recipient.",
  "Sushi changed the output token.",
  "Sushi returned an unapproved route executor.",
  "Sushi returned an unsupported executor entrypoint.",
  "Sushi calldata changed the minimum received amount.",
  "Sushi returned an invalid native transaction value.",
  "Sushi contract bytecode is unavailable.",
  "Sushi router bytecode is not approved.",
  "Sushi executor bytecode is not approved.",
  "Sushi deadline guard is not configured.",
  "Sushi deadline guard bytecode is not approved.",
  "RMT deadline guard could not simulate this trade.",
  "The selected maximum price impact is invalid.",
  "Trade exceeds your selected maximum price impact."
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
    const authorization = await requireAuthenticatedTradeWallet(request, recipient);
    await requireStockTokenExecutionEligible(token);
    const market = await verifyUniversalMarketPoolForToken(
      token,
      pair,
      await fetchRobinhoodStockRegistry()
    );
    const amountIn = BigInt(parsed.data.amountIn);
    const deadlineGuard = sushiDeadlineGuardConfiguration();
    await verifySushiDeadlineGuardConfiguration(deadlineGuard);
    const approvalRequired = parsed.data.side === "sell"
      && await sushiExecutionAllowance(token, recipient, deadlineGuard.address) < amountIn;
    const quote = approvalRequired
      ? await quoteSushiRoute({
          token,
          recipient,
          side: parsed.data.side,
          amountIn
        }, {
          chainId: 4663,
          requireTokenMetadata: true
        })
      : await quoteAndBuildSushiSwap({
          token,
          recipient,
          side: parsed.data.side,
          amountIn,
          maxPriceImpact: parsed.data.maxPriceImpactBps / 10_000
        }, {
          chainId: 4663,
          guard: deadlineGuard
        });

    return Response.json({
      ...quote,
      authorization,
      marketPair: market.poolAddress,
      marketVerified: true,
      approvalRequired,
      approvalSpender: deadlineGuard.address,
      quoteExpiresAt: "quoteExpiresAt" in quote
        ? quote.quoteExpiresAt
        : String(Math.floor(Date.now() / 1000) + 90)
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const identityResponse = tradeIdentityErrorResponse(cause);
    if (identityResponse) return identityResponse;
    const stockTokenResponse = stockTokenExecutionPolicyErrorResponse(cause);
    if (stockTokenResponse) return stockTokenResponse;
    const message = cause instanceof Error && publicTradeErrors.has(cause.message)
      ? cause.message
      : "Unable to verify this Sushi market and route.";
    return Response.json(
      { error: message },
      { status: 422, headers: { "Cache-Control": "no-store" } }
    );
  }
}
