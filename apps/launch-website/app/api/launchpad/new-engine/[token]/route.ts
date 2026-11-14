import { configuredCurveFixture } from "../../../../../lib/server/curve-fixture";
import { fixtureDiscoveryResponse } from "../../../../../lib/server/fixture-discovery";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  return fixtureDiscoveryResponse(request, configuredCurveFixture(request.headers), (await context.params).token);
}
export const HEAD = GET;
