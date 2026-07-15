import type { LaunchFeedResponse } from "../../../lib/launch-feed";
import { readFreshLaunches, resolveActiveFactory } from "../../../lib/server/launch-feed";
import { activeChain, activeFactoryStartBlock } from "../../../lib/network";

export const dynamic = "force-dynamic";

type ProcessLaunchCache = {
  key: string;
  expiresAt: number;
  launches: Promise<LaunchFeedResponse["launches"]>;
};

let processLaunchCache: ProcessLaunchCache | undefined;

function factoryCacheKey(activeFactory: Awaited<ReturnType<typeof resolveActiveFactory>>) {
  return [
    activeChain.id,
    activeFactory?.address.toLowerCase() ?? "unavailable",
    activeFactory?.version ?? "unknown",
    activeFactoryStartBlock.toString()
  ].join("-");
}

async function getCurrentFactoryLaunches() {
  // Resolve the registry on every request so a V5 -> V6 activation changes the
  // cache identity immediately. Only the expensive event scan is cached.
  const activeFactory = await resolveActiveFactory();
  const key = factoryCacheKey(activeFactory);
  const now = Date.now();
  if (processLaunchCache?.key === key && processLaunchCache.expiresAt > now) {
    return processLaunchCache.launches;
  }
  const launches = (async () => {
    const result = await readFreshLaunches(25, activeFactory);
    const confirmedFactory = await resolveActiveFactory();
    if (factoryCacheKey(confirmedFactory) !== key) {
      throw new Error("The active launch factory changed during synchronization.");
    }
    return result;
  })();
  processLaunchCache = { key, expiresAt: now + 10_000, launches };
  try {
    return await launches;
  } catch (error) {
    if (processLaunchCache?.launches === launches) processLaunchCache = undefined;
    throw error;
  }
}

export async function GET() {
  try {
    const response: LaunchFeedResponse = {
      launches: await getCurrentFactoryLaunches(),
      syncedAt: new Date().toISOString()
    };
    return Response.json(response, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    console.error("Fresh launch synchronization failed", error);
    return Response.json(
      { error: "Launch data is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
