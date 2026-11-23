import { configuredProductionDiscovery } from "../../../../../lib/server/production-discovery";
import { readMarketResponse, marketHeaders as headers } from "../../../../../lib/server/market-response";
import { marketIntervals } from "../../../../../lib/token-market";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params,
    args = new URL(request.url).searchParams;
  const requestedInterval = args.get("interval") ?? "300";
  const interval = Number(requestedInterval),
    before = args.get("before");
  if (!configuredProductionDiscovery(request.headers))
    return Response.json({ status: "unavailable" }, { status: 404, headers });
  if (
    !/^0x[0-9a-f]{40}$/i.test(token) ||
    String(interval) !== requestedInterval ||
    !marketIntervals.some((i) => i === interval) ||
    [...args.keys()].some(
      (k) => !["interval", "before"].includes(k) || args.getAll(k).length !== 1,
    ) ||
    (before !== null &&
      (!/^[1-9][0-9]{0,10}$/.test(before) || Number(before) % interval !== 0))
  )
    return Response.json({ status: "invalid" }, { status: 400, headers });
  return readMarketResponse(token, interval, before);
}
