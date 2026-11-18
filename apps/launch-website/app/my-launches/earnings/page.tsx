import type { Metadata } from "next";
import { headers } from "next/headers";
import { configuredCurveFixture } from "../../../lib/server/curve-fixture";
import { EarningsDashboard } from "../../_components/earnings-dashboard";
export const metadata: Metadata = { title: "Creator earnings | RMT Launch" };
export default async function EarningsPage() {
  const fixture = configuredCurveFixture(await headers());
  return <EarningsDashboard fixture={Boolean(fixture)} fixtureFactory={fixture?.factory} />;
}
