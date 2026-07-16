import { getAddress, isAddress } from "viem";
import { readIndexedLaunchOrigin } from "../../../../lib/server/indexed-launch-feed";
import { readV6LaunchOriginFromChain } from "../../../../lib/server/launch-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await context.params;
  if (!isAddress(rawToken)) {
    return Response.json({ error: "Invalid token address." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const token = getAddress(rawToken);
    let source: "indexer" | "rpc" = "indexer";
    const indexedLookup = await readIndexedLaunchOrigin(token).catch(() => null);
    const origin = indexedLookup?.origin ?? await (async () => {
      source = "rpc";
      return readV6LaunchOriginFromChain(
        token,
        indexedLookup ? BigInt(indexedLookup.indexedThrough) + 1n : undefined
      );
    })();
    if (!origin) {
      return Response.json(
        { error: "Active V6 launch not found." },
        { status: 404, headers: { "Cache-Control": "public, max-age=5, s-maxage=30" } }
      );
    }
    return Response.json(origin, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400",
        "X-RMT-Data-Source": source
      }
    });
  } catch {
    return Response.json(
      { error: "Launch origin is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } }
    );
  }
}
