import type { Metadata } from "next";
import { headers } from "next/headers";
import { TreasuryDashboard } from "../../_components/treasury-dashboard";
import { configuredProjectTreasuryFixture } from "../../../lib/server/project-treasury-fixture";
import Link from "next/link";
import { configuredSeaportAcquisition } from "../../../lib/server/seaport-acquisition";
export const metadata: Metadata = { title: "Project Treasury | RMT Launch" };
export default async function TreasuryPage({ searchParams }: { searchParams: Promise<{ address?: string }> }) {
  const query = await searchParams;
  const requestHeaders=await headers();
  return <><TreasuryDashboard fixture={Boolean(configuredProjectTreasuryFixture(requestHeaders))} initialTreasury={typeof query.address === "string" ? query.address : ""} />
    {configuredSeaportAcquisition(requestHeaders)&&<section className="lpPanel lpForm" style={{marginTop:18}}><h2>Seaport V2 local review</h2><p>Separately funded synthetic custody candidate. Production purchasing remains NO-GO.</p><Link className="lpBack" href="/my-launches/treasury/seaport-purchases" prefetch={false}>Review local Seaport acquisition →</Link></section>}</>;
}
