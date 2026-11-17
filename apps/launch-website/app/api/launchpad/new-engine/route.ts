import { configuredCurveFixture } from "../../../../lib/server/curve-fixture";
import { fixtureDiscoveryResponse } from "../../../../lib/server/fixture-discovery";
import { productionDiscoveryResponse } from "../../../../lib/server/production-discovery";

export const dynamic = "force-dynamic";
export function GET(request: Request) {
  const fixture = configuredCurveFixture(request.headers);
  return fixture ? fixtureDiscoveryResponse(request, fixture) : productionDiscoveryResponse(request);
}
export const HEAD = GET;
