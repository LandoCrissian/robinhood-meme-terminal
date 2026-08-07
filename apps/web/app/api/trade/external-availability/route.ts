import { getAddress, isAddress, type Address } from "viem";
import { getCachedExternalTradeVenues } from "../../../../lib/server/external-trade-venues";
import type { TradeVenueId } from "../../../../lib/trade-route-selection";
import { stockTokenExecutionPolicy } from "../../../../lib/server/robinhood-stock-token-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The desktop scanner resolves at most 48 markets per pass. Keep this endpoint
// aligned so a valid scanner batch cannot be rejected and falsely downgraded.
const MAX_TOKENS = 48;
const CONCURRENCY = 12;

type Availability = {
  token: Address;
  status: "ready" | "view-only" | "unavailable";
  venues: TradeVenueId[];
};

async function mapWithConcurrency<T, Result>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<Result>
) {
  const results = new Array<Result>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function GET(request: Request) {
  const rawTokens = new URL(request.url).searchParams.get("tokens")?.split(",") ?? [];
  const tokens = [...new Set(rawTokens.map((token) => token.trim().toLowerCase()).filter(Boolean))];
  if (tokens.length === 0 || tokens.length > MAX_TOKENS || tokens.some((token) => !isAddress(token))) {
    return Response.json(
      { error: `Provide between 1 and ${MAX_TOKENS} valid token addresses.` },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const availability = await mapWithConcurrency(tokens.map((token) => getAddress(token)), CONCURRENCY, async (token) => {
    try {
      const policy = await stockTokenExecutionPolicy(token);
      if (policy.status !== "eligible") {
        return {
          token,
          status: policy.status === "view-only" ? "view-only" : "unavailable",
          venues: []
        } satisfies Availability;
      }
      const venues = await getCachedExternalTradeVenues(token);
      return {
        token,
        status: venues.length > 0 ? "ready" : "view-only",
        venues: [...new Set(venues.map((venue) => venue.venue))]
      } satisfies Availability;
    } catch {
      return {
        token,
        status: "unavailable",
        venues: []
      } satisfies Availability;
    }
  });

  return Response.json(
    { availability },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=240" } }
  );
}
