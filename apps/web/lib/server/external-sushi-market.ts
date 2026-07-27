import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import { RUNNER_THRESHOLDS } from "../external-market-ranking";

const DEXSCREENER_TOKEN_PAIRS_API = "https://api.dexscreener.com/token-pairs/v1/robinhood";
const DEXSCREENER_PAGE = "https://dexscreener.com/robinhood/";
const TIMEOUT_MS = 8_000;

const rawTokenSchema = z.object({ address: z.string() }).passthrough();
const rawPairSchema = z.object({
  chainId: z.string(),
  dexId: z.string(),
  url: z.string(),
  pairAddress: z.string(),
  baseToken: rawTokenSchema,
  quoteToken: rawTokenSchema,
  liquidity: z.object({
    usd: z.union([z.number(), z.string()])
  }).optional()
}).passthrough();

type MarketFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type VerifiedExternalSushiMarket = {
  token: Address;
  pair: Address;
  dexId: string;
  liquidityUsd: number;
  url: string;
};

function safeAddress(value: string) {
  return isAddress(value) ? getAddress(value) : undefined;
}

export async function verifyExternalSushiMarket(
  params: { token: Address; pair: Address },
  dependencies: { fetch?: MarketFetch; timeoutMs?: number } = {}
): Promise<VerifiedExternalSushiMarket> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? TIMEOUT_MS);
  let response: Response;
  try {
    response = await (dependencies.fetch ?? fetch)(`${DEXSCREENER_TOKEN_PAIRS_API}/${params.token}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });
  } catch (cause) {
    if (controller.signal.aborted) throw new Error("Market verification timed out.");
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error("Market verification is unavailable.");

  const payload = z.array(rawPairSchema).safeParse(await response.json());
  if (!payload.success) throw new Error("Market verification returned invalid data.");
  const requestedPair = params.pair.toLowerCase();
  const candidate = payload.data.find((pair) => pair.pairAddress.toLowerCase() === requestedPair);
  if (!candidate) throw new Error("This Sushi pool is no longer verified.");

  const pair = safeAddress(candidate.pairAddress);
  const baseToken = safeAddress(candidate.baseToken.address);
  const quoteToken = safeAddress(candidate.quoteToken.address);
  const liquidityUsd = typeof candidate.liquidity?.usd === "number"
    ? candidate.liquidity.usd
    : Number(candidate.liquidity?.usd);
  if (
    !pair
    || pair.toLowerCase() !== requestedPair
    || candidate.chainId !== "robinhood"
    || !candidate.dexId.toLowerCase().includes("sushi")
    || !candidate.url.startsWith(DEXSCREENER_PAGE)
    || (baseToken?.toLowerCase() !== params.token.toLowerCase()
      && quoteToken?.toLowerCase() !== params.token.toLowerCase())
    || !Number.isFinite(liquidityUsd)
    || liquidityUsd < RUNNER_THRESHOLDS.minimumDisplayLiquidityUsd
  ) {
    throw new Error("This Sushi pool is no longer eligible for an RMT quote.");
  }

  return {
    token: getAddress(params.token),
    pair,
    dexId: candidate.dexId.slice(0, 40),
    liquidityUsd,
    url: candidate.url.slice(0, 300)
  };
}
