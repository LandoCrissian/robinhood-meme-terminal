import type { Metadata } from "next";
import { headers } from "next/headers";
import { TreasuryDashboard } from "../../_components/treasury-dashboard";
import { configuredProjectTreasuryFixture } from "../../../lib/server/project-treasury-fixture";
export const metadata: Metadata = { title: "Project Treasury | RMT Launch" };
export default async function TreasuryPage({ searchParams }: { searchParams: Promise<{ address?: string }> }) {
  const query = await searchParams;
  return <TreasuryDashboard fixture={Boolean(configuredProjectTreasuryFixture(await headers()))} initialTreasury={typeof query.address === "string" ? query.address : ""} />;
}
