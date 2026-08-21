import { respondWithVNextUniversalMarketSearch } from "../../../../lib/server/vnext-universal-market-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(request: Request) {
  return respondWithVNextUniversalMarketSearch(request);
}
