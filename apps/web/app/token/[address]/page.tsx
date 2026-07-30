import type { Metadata } from "next";
import { ProjectDetailPage } from "../../project/[address]/project-detail-page";
import { buildLegacyTokenMetadata } from "../../../lib/public-project-discovery";

type TokenRouteProps = {
  params: Promise<{ address: string }>;
};

export async function generateMetadata({ params }: TokenRouteProps): Promise<Metadata> {
  const { address } = await params;
  return buildLegacyTokenMetadata(address);
}

// Existing token URLs remain valid while Project becomes the canonical
// project-first surface for RMT-native launches.
export default function LegacyTokenProjectPage() {
  return <ProjectDetailPage />;
}
