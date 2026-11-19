import type { Metadata } from "next";
import { headers } from "next/headers";
import { ReclaimDashboard } from "../_components/reclaim-dashboard";
import { configuredReclaimFixture } from "../../lib/server/reclaim-fixture";

export const metadata: Metadata = { title: "RMT Reclaim | RMT Launch", description: "Independently funded permanent NFT surrender through verified native burning or validated immutable sinks. Production claims are disabled." };
export default async function ReclaimPage({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  const query = await searchParams;
  return <ReclaimDashboard fixture={Boolean(configuredReclaimFixture(await headers()))} initialCampaign={typeof query.campaign === "string" ? query.campaign : ""} />;
}
