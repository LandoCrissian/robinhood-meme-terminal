import { NextResponse } from "next/server";
import { readLaunchIntelligence, readLaunchSourceAvailability } from "../../../../lib/server/launch-intelligence-reader";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const result = await readLaunchIntelligence({
    token: params.get("token") ?? undefined,
    q: params.get("q") ?? undefined,
    source: params.get("source") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
    limit: 50,
  });
  const availableSources = await readLaunchSourceAvailability(result);
  return NextResponse.json({ ...result, availableSources }, {
    headers: {
      "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30",
    },
  });
}
