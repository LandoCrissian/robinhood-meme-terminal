import { configuredCurveFixture } from "../../../../../lib/server/curve-fixture";
import { fixtureDiscoveryResponse } from "../../../../../lib/server/fixture-discovery";
import { productionDiscoveryResponse } from "../../../../../lib/server/production-discovery";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const token = (await context.params).token;
  const fixture = configuredCurveFixture(request.headers);
  return fixture ? fixtureDiscoveryResponse(request, fixture, token) : productionDiscoveryResponse(request, token);
}
export const HEAD = GET;
