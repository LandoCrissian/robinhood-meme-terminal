import { getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { isUniswapV4PoolId } from "../external-v4-evidence";
import type { TradeVenueId } from "../trade-route-selection";
import { verifyExternalSushiMarket } from "./external-sushi-market";
import { verifyExternalUniswapMarket } from "./external-uniswap-market";
import { verifyExternalUniswapV4Market } from "./external-uniswap-v4-market";

const DEXSCREENER_TOKEN_PAIRS_API = "https://api.dexscreener.com/token-pairs/v1/robinhood";
const TIMEOUT_MS = 8_000;
const MAX_CANDIDATES_PER_VENUE = 3;
const VENUE_CACHE_TTL_MS = 5 * 60_000;
const MAX_VENUE_CACHE_ENTRIES = 256;

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
  venue: TradeVenueId;
  pair: string;
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
  verifyUniswapV4?: (params: { token: Address; poolId: Hex }) => Promise<{
    poolId: Hex;
    liquidityUsd: number;
    poolKey: {
      currency0: Address;
      currency1: Address;
    };
  }>;
};

type VenueCacheEntry = {
  expiresAt: number;
  venues: ExternalTradeVenue[];
};

const venueCache = new Map<string, VenueCacheEntry>();
const venueRequests = new Map<string, Promise<ExternalTradeVenue[]>>();

function venueKind(dexId: string, pairAddress: string) {
  const normalized = dexId.toLowerCase();
  if (normalized.includes("sushi")) return "sushi" as const;
  if (normalized === "uniswap" || normalized.startsWith("uniswap-")) {
    return isUniswapV4PoolId(pairAddress) ? "uniswap-v4" as const : "uniswap-v3" as const;
  }
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
      const venue = venueKind(pair.dexId, pair.pairAddress);
      const validPair = venue === "uniswap-v4"
        ? isUniswapV4PoolId(pair.pairAddress)
        : isAddress(pair.pairAddress);
      if (
        !venue
        || pair.chainId !== "robinhood"
        || !validPair
        || (pair.baseToken.address.toLowerCase() !== tokenLower
          && pair.quoteToken.address.toLowerCase() !== tokenLower)
      ) return [];
      return [{
        venue,
        pair: venue === "uniswap-v4" ? pair.pairAddress.toLowerCase() : getAddress(pair.pairAddress),
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
  const verifyUniswapV4 = dependencies.verifyUniswapV4 ?? ((params) => (
    verifyExternalUniswapV4Market(params, { fetch: cachedFetch })
  ));
  const verified = await Promise.all(candidates.map(async (
    candidate
  ): Promise<ExternalTradeVenue | undefined> => {
    try {
      if (candidate.venue === "uniswap-v4") {
        const result = await verifyUniswapV4({
          token,
          poolId: candidate.pair as Hex
        });
        if (
          result.poolKey.currency0.toLowerCase() !== zeroAddress
          && result.poolKey.currency1.toLowerCase() !== zeroAddress
        ) {
          return undefined;
        }
        return {
          venue: candidate.venue,
          pair: result.poolId,
          dexId: "uniswap-v4",
          liquidityUsd: result.liquidityUsd,
          verification: "dex-and-onchain" as const
        };
      }
      const result = candidate.venue === "sushi"
        ? await verifySushi({ token, pair: candidate.pair as Address })
        : await verifyUniswap({ token, pair: candidate.pair as Address });
      return {
        venue: candidate.venue,
        pair: result.pair,
        dexId: result.dexId ?? (candidate.venue === "sushi" ? "sushi" : "uniswap-v3"),
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

export async function getCachedExternalTradeVenues(
  token: Address,
  options: { force?: boolean } = {}
): Promise<ExternalTradeVenue[]> {
  const key = token.toLowerCase();
  const now = Date.now();
  const cached = venueCache.get(key);
  if (!options.force && cached && cached.expiresAt > now) return cached.venues;

  const pending = venueRequests.get(key);
  if (pending) return pending;

  const request = discoverExternalTradeVenues(token)
    .then((venues) => {
      if (venueCache.size >= MAX_VENUE_CACHE_ENTRIES) {
        for (const [address, entry] of venueCache) {
          if (entry.expiresAt <= now || venueCache.size >= MAX_VENUE_CACHE_ENTRIES) {
            venueCache.delete(address);
          }
          if (venueCache.size < MAX_VENUE_CACHE_ENTRIES) break;
        }
      }
      venueCache.set(key, {
        expiresAt: Date.now() + VENUE_CACHE_TTL_MS,
        venues
      });
      return venues;
    })
    .finally(() => venueRequests.delete(key));

  venueRequests.set(key, request);
  return request;
}
