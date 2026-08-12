import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAddress } from "viem";
import { ProjectDetailPage } from "./project-detail-page";
import { buildPublicProjectMetadata } from "../../../lib/public-project-discovery";

type ProjectRouteProps = {
  params: Promise<{ address: string }>;
};

export async function generateMetadata({ params }: ProjectRouteProps): Promise<Metadata> {
  const { address } = await params;
  if (!isAddress(address)) return {
    title: "Project pages are paused | RMT",
    robots: { index: false, follow: false }
  };
  return buildPublicProjectMetadata(address);
}

export default async function ProjectPage({ params }: ProjectRouteProps) {
  const { address } = await params;
  if (!isAddress(address)) redirect("/explore");
  return <ProjectDetailPage />;
}
