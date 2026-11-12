import { NextResponse } from "next/server";
import { launchpadPublicOperations, readLaunchpadPublicData, type LaunchpadPublicOperation } from "../../../../../lib/server/new-launchpad-public-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedParams = ["chainId", "token", "limit", "cursor"];
const statusCode = { ready: 200, delayed: 503, disabled: 404, not_found: 404, rate_limited: 429, invalid: 400 } as const;

export async function GET(request: Request, context: { params: Promise<{ operation: string }> }) {
  const { operation } = await context.params;
  const headers = new Headers({ "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" });
  const params = new URL(request.url).searchParams;
  const chain = params.get("chainId");
  const limit = params.get("limit");
  if (!launchpadPublicOperations.includes(operation as LaunchpadPublicOperation) || !chain || !/^[1-9]\d{0,9}$/.test(chain)
    || (limit !== null && !/^[1-9]\d?$/.test(limit)) || [...params.keys()].some((key) => !allowedParams.includes(key) || params.getAll(key).length !== 1)) {
    return NextResponse.json({ status: "invalid", reason: "Invalid launch data request." }, { status: 400, headers });
  }
  const result = await readLaunchpadPublicData({
    operation: operation as LaunchpadPublicOperation,
    chainId: Number(chain),
    token: params.get("token") ?? undefined,
    limit: limit === null ? undefined : Number(limit),
    cursor: params.get("cursor") ?? undefined,
  });
  if (result.retryAfterSeconds) headers.set("Retry-After", result.retryAfterSeconds.toString());
  return NextResponse.json(result, { status: statusCode[result.status], headers });
}
