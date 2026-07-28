import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import { verifyExternalSushiMarket } from "./external-sushi-market";
import { verifyExternalUniswapMarket } from "./external-uniswap-market";

const DEXSCREENER_TOKEN_PAIRS_API = "https://api.dexscreener.com/token-pairs/v1/robinhood";
const TIMEOUT_MS = 8_000;
const MAX_CANDIDATES_PER_VENUE = 3;

const rawPairSchema = z.object({
  chainId: z.string(),
  dexId: z.string(),
  pairAddress: z.string(),
  baseToken: z.object({ address: z.string() }).passthrough(),
  quoteToken: z.object({ address: z.string() }).passthrough(),
  liquidity: z.object({ usd: z.union([z.number(), z.string()]) }).optional()
}).passthrough();

const rawPairsSchema = z.array(rawPairSchema);

export type ExternalTradeVenue = {
  venue: "sushi" | "uniswap";
  pair: Address;
  dexId: string;
  liquidityUsd: number;
  verification: "dex-and-route" | "dex-and-onchain";
};

type VenueVerifier = (params: { token: Address; pair: Address }) => Promise<{
  pair: Address;
  dexId?: string;
  liquidityUsd: number;
}>;

type DiscoveryDependencies = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  verifySushi?: VenueVerifier;
  verifyUniswap?: VenueVerifier;
};

function venueKind(dexId: string) {
  const normalized = dexId.toLowerCase();
  if (normalized.includes("sushi")) return "sushi" as const;
  if (normalized === "uniswap" || normalized.startsWith("uniswap-")) return "uniswap" as const;
  return undefined;
}

function liquidityUsd(value: number | string | undefined) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function discoverExternalTradeVenues(
  token: Address,
  dependencies: DiscoveryDependencies = {}
): Promise<ExternalTradeVenue[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? TIMEOUT_MS);
  let response: Response;
  try {
    response = await (dependencies.fetch ?? fetch)(`${DEXSCREENER_TOKEN_PAIRS_API}/${token}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });
  } catch (cause) {
    if (controller.signal.aborted) throw new Error("Trade venue discovery timed out.");
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error("Trade venue discovery is unavailable.");

  const payload = rawPairsSchema.safeParse(await response.json());
  if (!payload.success) throw new Error("Trade venue discovery returned invalid data.");
  const tokenLower = token.toLowerCase();
  const candidates = payload.data
    .flatMap((pair) => {
      const venue = venueKind(pair.dexId);
      if (
        !venue
        || pair.chainId !== "robinhood"
        || !isAddress(pair.pairAddress)
        || (pair.baseToken.address.toLowerCase() !== tokenLower
          && pair.quoteToken.address.toLowerCase() !== tokenLower)
      ) return [];
      return [{
        venue,
        pair: getAddress(pair.pairAddress),
        liquidityUsd: liquidityUsd(pair.liquidity?.usd)
      }];
    })
    .sort((left, right) => right.liquidityUsd - left.liquidityUsd)
    .filter((candidate, index, all) => all.findIndex((item) => (
      item.venue === candidate.venue
      && item.pair.toLowerCase() === candidate.pair.toLowerCase()
    )) === index)
    .filter((candidate, index, all) => (
      all.slice(0, index).filter((item) => item.venue === candidate.venue).length
      < MAX_CANDIDATES_PER_VENUE
    ));

  const cachedFetch = async () => Response.json(payload.data);
  const verifySushi: VenueVerifier = dependencies.verifySushi ?? ((params) => (
    verifyExternalSushiMarket(params, { fetch: cachedFetch })
  ));
  const verifyUniswap: VenueVerifier = dependencies.verifyUniswap ?? ((params) => (
    verifyExternalUniswapMarket(params, { fetch: cachedFetch })
  ));
  const verified = await Promise.all(candidates.map(async (candidate) => {
    try {
      const result = candidate.venue === "sushi"
        ? await verifySushi({ token, pair: candidate.pair })
        : await verifyUniswap({ token, pair: candidate.pair });
      return {
        venue: candidate.venue,
        pair: result.pair,
        dexId: result.dexId ?? "uniswap",
        liquidityUsd: result.liquidityUsd,
        verification: candidate.venue === "sushi"
          ? "dex-and-route" as const
          : "dex-and-onchain" as const
      };
    } catch {
      return undefined;
    }
  }));

  return verified
    .filter((venue): venue is ExternalTradeVenue => venue !== undefined)
    .sort((left, right) => right.liquidityUsd - left.liquidityUsd);
}
