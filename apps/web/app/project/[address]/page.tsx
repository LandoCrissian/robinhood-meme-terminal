import { isAddress } from "viem";
import { ApprovedProjectPage } from "./approved-project-page";
import { ProjectDetailPage } from "./project-detail-page";

export default async function ProjectPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return isAddress(address)
    ? <ProjectDetailPage />
    : <ApprovedProjectPage slug={address} />;
}
