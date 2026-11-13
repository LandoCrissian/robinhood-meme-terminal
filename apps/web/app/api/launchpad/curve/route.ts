import { getAddress, isAddress, type Address } from "viem";
import { curveLoopbackRequest, readCurveRuntime, verifiedCurveRuntime } from "../../../../lib/server/curve-launch-config";
import { CurveLaunchIndex, readCurveState } from "../../../../lib/server/curve-launch-index";
import { readLaunchpadBlock } from "../../../../lib/server/new-launchpad-finality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
function respond(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...headers, ...(status === 429 ? { "Retry-After": "60" } : {}) } });
}

export async function GET(request: Request) {
  if (!curveLoopbackRequest(request)) return respond({ status: "disabled" }, 404);
  const url = new URL(request.url);
  const params = url.searchParams;
  const allowed = ["token", "creator", "account"] as const;
  if (url.search.length > 256 || [...params.keys()].some((key) => !allowed.some((entry) => entry === key))
    || allowed.some((key) => params.getAll(key).length > 1 || (params.has(key) && !isAddress(params.get(key)!)))
    || (params.has("account") && !params.has("token"))) return respond({ status: "invalid", reason: "Use exact contract or wallet addresses." }, 400);
  const address = (key: typeof allowed[number]): Address | undefined => params.has(key) ? getAddress(params.get(key)!) : undefined;
  let index: CurveLaunchIndex | undefined;
  try {
    const runtimeConfig = readCurveRuntime();
    if (!runtimeConfig) return respond({ status: "disabled" }, 404);
    index = new CurveLaunchIndex(runtimeConfig);
    if (!index.consume()) return respond({ status: "rate_limited", reason: "Curve review read limit reached." }, 429);
    const ready = await verifiedCurveRuntime(runtimeConfig);
    const head = await ready.rpc.getBlockNumber({ cacheTime: 0 });
    const block = await readLaunchpadBlock(ready.rpc, head, head);
    const caughtUp = await index.sync(ready, block);
    if (!caughtUp) return respond({ status: "delayed", reason: "The bounded curve index is catching up. Retry in a moment." }, 503);
    const launches = index.list({ token: address("token"), creator: address("creator") });
    if (!address("token")) {
      for (const launch of launches) {
        if ((await readLaunchpadBlock(ready.rpc, BigInt(launch.blockNumber), head)).hash !== launch.blockHash) {
          throw new Error("The curve directory is reorganizing.");
        }
      }
      if ((await readLaunchpadBlock(ready.rpc, head, head)).hash !== block.hash) throw new Error("The curve directory changed branches.");
      return respond({ status: "ready", launches, observation: { chainId: 31337, blockNumber: head.toString(), blockHash: block.hash, l1Finality: "unverified" } });
    }
    const launch = launches[0];
    if (!launch) return respond({ status: "not_found", reason: "This token has no verified curve launch." }, 404);
    const state = await readCurveState(ready, launch, block, {
      graduation: index.graduation(launch.token), migration: (version) => index!.migration(launch.token, version),
      collection: index.collection(launch.token),
    }, address("account"));
    return respond({ status: "ready", launch, state });
  } catch {
    return respond({ status: "delayed", reason: "Curve evidence could not be verified. Retry without resubmitting a transaction." }, 503);
  } finally {
    index?.close();
  }
}
