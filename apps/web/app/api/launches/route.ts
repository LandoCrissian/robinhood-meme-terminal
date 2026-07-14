import { unstable_cache } from "next/cache";
import { getFactoryAddress } from "../../../lib/contracts";
import type { LaunchFeedResponse } from "../../../lib/launch-feed";
import { readFreshLaunches } from "../../../lib/server/launch-feed";
import { activeChain, activeFactoryStartBlock } from "../../../lib/network";

export const dynamic = "force-dynamic";

const launchCacheIdentity = `${activeChain.id}-${getFactoryAddress()?.toLowerCase() ?? "unconfigured"}-${activeFactoryStartBlock.toString()}`;
const getCachedLaunches = unstable_cache(readFreshLaunches, [`rmt-fresh-launches-${launchCacheIdentity}`], {
  revalidate: 10,
  tags: [`rmt-launches-${launchCacheIdentity}`]
});

export async function GET() {
  try {
    const response: LaunchFeedResponse = {
      launches: await getCachedLaunches(),
      syncedAt: new Date().toISOString()
    };
    return Response.json(response, {
      headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" }
    });
  } catch (error) {
    console.error("Fresh launch synchronization failed", error);
    return Response.json(
      { error: "Launch data is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
