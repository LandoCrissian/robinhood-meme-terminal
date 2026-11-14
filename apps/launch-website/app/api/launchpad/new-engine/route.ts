import { configuredCurveFixture } from "../../../../lib/server/curve-fixture";
import { fixtureDiscoveryResponse } from "../../../../lib/server/fixture-discovery";

export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return fixtureDiscoveryResponse(request, configuredCurveFixture(request.headers));
}
export const HEAD = GET;
