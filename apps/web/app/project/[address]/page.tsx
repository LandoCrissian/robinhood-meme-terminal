import type { Metadata } from "next";
import { isAddress } from "viem";
import { ApprovedProjectPage } from "./approved-project-page";
import { ProjectDetailPage } from "./project-detail-page";
import { buildPublicProjectMetadata } from "../../../lib/public-project-discovery";

type ProjectRouteProps = {
  params: Promise<{ address: string }>;
};

export async function generateMetadata({ params }: ProjectRouteProps): Promise<Metadata> {
  const { address } = await params;
  return buildPublicProjectMetadata(address);
}

export default async function ProjectPage({ params }: ProjectRouteProps) {
  const { address } = await params;
  return isAddress(address)
    ? <ProjectDetailPage />
    : <ApprovedProjectPage slug={address} />;
}
