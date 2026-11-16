import { reviewLaunchDraft } from "../../../../lib/server/launch-draft";
import { configuredCurveFixture } from "../../../../lib/server/curve-fixture";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return reviewLaunchDraft(request, Boolean(configuredCurveFixture(request.headers)));
}
