import { getAddress, isAddress } from "viem";
import { discoverExternalTradeVenues } from "../../../../lib/server/external-trade-venues";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || !isAddress(token)) {
    return Response.json(
      { error: "A valid token address is required." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const venues = await discoverExternalTradeVenues(getAddress(token));
    return Response.json(
      { token: getAddress(token), venues },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json(
      { error: "RMT could not verify executable venues for this token." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
