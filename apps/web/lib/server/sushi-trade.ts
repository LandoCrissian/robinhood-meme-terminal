import { getAddress, zeroAddress, type Address } from "viem";
import { z } from "zod";
import { activeChain, isMainnetRelease } from "../network";
import { SUSHI_NATIVE_TOKEN, SUSHI_QUOTE_SLIPPAGE_BPS, type SushiIndicativeQuote } from "../sushi";

const SUSHI_QUOTE_API = "https://api.sushi.com/quote/v7";
const MAX_UINT256 = (1n << 256n) - 1n;
const decimalString = z.string().regex(/^\d+$/);
const quoteResponseSchema = z.object({
  status: z.enum(["Success", "Partial", "NoWay"]),
  amountIn: decimalString.optional(),
  assumedAmountOut: decimalString.optional(),
  amountOut: decimalString.optional(),
  priceImpact: z.union([z.number(), z.string()]).optional()
}).passthrough();

type SushiFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function sushiQuotesEnabled(environment: Readonly<Record<string, string | undefined>> = process.env) {
  return environment.RMT_SUSHI_QUOTES_ENABLED === "true";
}

function parsePriceImpact(value: number | string | undefined) {
  if (value === undefined) return 0;
  if (typeof value === "string" && value.trim() === "") throw new Error("Sushi returned an invalid price impact.");
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error("Sushi returned an invalid price impact.");
  return parsed;
}

export async function quoteSushiRoute(
  params: { token: Address; recipient: Address; side: "buy" | "sell"; amountIn: bigint },
  dependencies: { fetch?: SushiFetch; enabled?: boolean; timeoutMs?: number } = {}
): Promise<SushiIndicativeQuote> {
  if (!isMainnetRelease || activeChain.id !== 4663) throw new Error("Sushi quotes are available only on Robinhood Chain mainnet.");
  if (!(dependencies.enabled ?? sushiQuotesEnabled())) throw new Error("Sushi quote discovery is not enabled.");
  if (params.amountIn <= 0n || params.amountIn > MAX_UINT256) throw new Error("Trade amount is outside the supported range.");
  if (params.recipient.toLowerCase() === zeroAddress) throw new Error("A valid wallet recipient is required.");

  const tokenIn = params.side === "buy" ? SUSHI_NATIVE_TOKEN : params.token;
  const tokenOut = params.side === "buy" ? params.token : SUSHI_NATIVE_TOKEN;
  const url = new URL(`${SUSHI_QUOTE_API}/${activeChain.id}`);
  url.searchParams.set("tokenIn", tokenIn);
  url.searchParams.set("tokenOut", tokenOut);
  url.searchParams.set("amount", params.amountIn.toString());
  url.searchParams.set("maxSlippage", (SUSHI_QUOTE_SLIPPAGE_BPS / 10_000).toString());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 8_000);
  let response: Response;
  try {
    response = await (dependencies.fetch ?? fetch)(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });
  } catch (cause) {
    if (controller.signal.aborted) throw new Error("Sushi quote discovery timed out.");
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error("Sushi quote discovery is unavailable.");

  const parsed = quoteResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Sushi returned an invalid quote response.");
  if (parsed.data.status === "NoWay") throw new Error("Sushi does not have a route for this trade yet.");
  if (parsed.data.status !== "Success") throw new Error("Sushi cannot fill the complete trade amount.");
  if (parsed.data.amountIn !== undefined && BigInt(parsed.data.amountIn) !== params.amountIn) throw new Error("Sushi returned a quote for a different input amount.");

  const rawQuoteOut = parsed.data.assumedAmountOut ?? parsed.data.amountOut;
  if (!rawQuoteOut) throw new Error("Sushi returned an invalid quote response.");
  const quoteOut = BigInt(rawQuoteOut);
  const minimumOut = quoteOut * BigInt(10_000 - SUSHI_QUOTE_SLIPPAGE_BPS) / 10_000n;
  if (quoteOut <= 0n || minimumOut <= 0n) throw new Error("Sushi returned an invalid quote amount.");

  return {
    chainId: activeChain.id,
    venue: "sushi-aggregator",
    protocol: "SUSHI",
    token: getAddress(params.token),
    recipient: getAddress(params.recipient),
    side: params.side,
    amountIn: params.amountIn.toString(),
    quoteOut: quoteOut.toString(),
    minimumOut: minimumOut.toString(),
    priceImpact: parsePriceImpact(parsed.data.priceImpact),
    executable: false,
    verifiedInput: true
  };
}
