import { getAddress, isAddress } from "viem";
import { getCachedExternalTradeVenues } from "../../../../lib/server/external-trade-venues";
import { stockTokenExecutionPolicy } from "../../../../lib/server/robinhood-stock-token-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const token = searchParams.get("token");
  if (!token || !isAddress(token)) {
    return Response.json(
      { error: "A valid token address is required." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const canonicalToken = getAddress(token);
    const policy = await stockTokenExecutionPolicy(canonicalToken);
    if (policy.status !== "eligible") {
      return Response.json(
        {
          token: canonicalToken,
          venues: [],
          restriction: policy.status === "view-only"
            ? "official-stock-token-view-only"
            : "stock-token-verification-unavailable"
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    const venues = await getCachedExternalTradeVenues(canonicalToken, {
      force: searchParams.get("refresh") === "1"
    });
    return Response.json(
      { token: canonicalToken, venues },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json(
      { error: "RMT could not verify executable venues for this token." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
