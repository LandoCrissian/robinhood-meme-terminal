import type { LaunchFeedResponse } from "../../../lib/launch-feed";
import {
  hasConfiguredLaunchIndexer,
  readIndexedLaunches
} from "../../../lib/server/indexed-launch-feed";
import { readFreshLaunches, resolveActiveFactory } from "../../../lib/server/launch-feed";
import { isMainnetRelease } from "../../../lib/network";

export const dynamic = "force-dynamic";

const PROCESS_CACHE_MS = 15_000;
const SHARED_CACHE_CONTROL = "public, s-maxage=15, stale-while-revalidate=180, stale-if-error=600";

type FeedSnapshot = LaunchFeedResponse & { source: "indexer" | "rpc" };
type ProcessLaunchCache = {
  expiresAt: number;
  snapshot: FeedSnapshot;
};

let processLaunchCache: ProcessLaunchCache | undefined;
let refreshInFlight: Promise<FeedSnapshot> | undefined;
let lastSuccessfulSnapshot: FeedSnapshot | undefined;

async function readCurrentLaunches(): Promise<FeedSnapshot> {
  if (hasConfiguredLaunchIndexer()) {
    const indexed = await readIndexedLaunches(25);
    return { ...indexed, source: "indexer" };
  }

  if (isMainnetRelease) {
    throw new Error("The production launch indexer is not configured.");
  }

  // Local and test deployments can still operate without the production
  // indexer. Production uses the confirmed index so visitors never trigger a
  // full factory-history RPC scan.
  const activeFactory = await resolveActiveFactory();
  const launches = await readFreshLaunches(25, activeFactory);
  const confirmedFactory = await resolveActiveFactory();
  if (
    activeFactory?.address.toLowerCase() !== confirmedFactory?.address.toLowerCase()
      || activeFactory?.version !== confirmedFactory?.version
  ) {
    throw new Error("The active launch factory changed during synchronization.");
  }
  return { launches, syncedAt: new Date().toISOString(), source: "rpc" };
}

async function getLaunchSnapshot() {
  const now = Date.now();
  if (processLaunchCache && processLaunchCache.expiresAt > now) {
    return processLaunchCache.snapshot;
  }
  if (refreshInFlight) return refreshInFlight;

  const refresh = readCurrentLaunches();
  refreshInFlight = refresh;
  try {
    const result = await refresh;
    if (!result.stale) lastSuccessfulSnapshot = result;
    processLaunchCache = { expiresAt: Date.now() + PROCESS_CACHE_MS, snapshot: result };
    return result;
  } finally {
    if (refreshInFlight === refresh) refreshInFlight = undefined;
  }
}

function responseHeaders(source: FeedSnapshot["source"]) {
  return {
    "Cache-Control": SHARED_CACHE_CONTROL,
    "X-RMT-Data-Source": source
  };
}

export async function GET() {
  try {
    const response = await getLaunchSnapshot();
    return Response.json(response, { headers: responseHeaders(response.source) });
  } catch (error) {
    console.error("Fresh launch synchronization failed", error);
    if (lastSuccessfulSnapshot) {
      const response: FeedSnapshot = {
        ...lastSuccessfulSnapshot,
        stale: true,
        error: "Live launch refresh is delayed. Showing the last confirmed snapshot."
      };
      return Response.json(response, { headers: responseHeaders(response.source) });
    }
    return Response.json(
      { error: "Launch data is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
