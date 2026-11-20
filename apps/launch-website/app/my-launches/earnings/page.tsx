import type { Metadata } from "next";
import { headers } from "next/headers";
import { configuredCurveFixture } from "../../../lib/server/curve-fixture";
import { configuredClaimProfileFixture } from "../../../lib/server/claim-profile-fixture";
import { EarningsDashboard } from "../../_components/earnings-dashboard";
import { availableProductionFinancial } from "../../../lib/server/production-financial";
import { curveProductionPins } from "../../../lib/server/curve-production";
export const metadata: Metadata = { title: "Creator earnings | RMT Launch" };
export default async function EarningsPage() {
  const requestHeaders = await headers();
  const fixture = configuredCurveFixture(requestHeaders);
  const claims = !fixture && await availableProductionFinancial(requestHeaders, "claims");
  return <EarningsDashboard fixture={Boolean(fixture)} profileFixture={Boolean(configuredClaimProfileFixture(requestHeaders))} fixtureFactory={fixture?.factory}
    productionClaims={Boolean(claims)} productionFactory={claims ? curveProductionPins.factory[0] : undefined} />;
}
