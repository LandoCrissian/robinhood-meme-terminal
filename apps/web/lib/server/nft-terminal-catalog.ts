import {
  RMT_CURATED_NFT_PROJECTS,
  activeRmtCuratedNftProjects,
  type RmtCuratedNftProject,
} from "@rmt/shared/nft/project-registry";
import { rmtNftCollectionTechnicalVerification } from "@rmt/shared/nft/technical-verification";
import type { RmtNftProjectMarketplaceRead } from "@rmt/shared/nft/project-market";
import { readRmtNftItem, type RmtNftItemReaderResult } from "./nft-project-market";

export type RmtNftTerminalCatalogView = "active" | "new" | "minting" | "trending" | "watching";

export type RmtNftTerminalProjectCard = {
  projectId: string;
  displayName: string;
  status: "ACTIVE";
  rmtCurated: true;
  chainId: 4663;
  collections: readonly {
    contractAddress: `0x${string}`;
    standard: "ERC721" | "ERC1155" | null;
    verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
  }[];
  projectToken: RmtCuratedNftProject["projectToken"];
};

export type RmtNftTerminalCollectionCard = {
  projectId: string;
  displayName: string;
  chainId: 4663;
  contractAddress: `0x${string}`;
  standard: "ERC721" | "ERC1155" | null;
  verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
  projectStatus: "ACTIVE" | "WATCHING";
  newEvidence: {
    authority: "TECHNICAL_VERIFICATION_OBSERVED";
    observedAt: string;
    startBlock: string;
    deploymentTransaction: `0x${string}`;
  } | null;
  publicUrl: string | null;
};

export type RmtNftTerminalCatalog = {
  schemaVersion: 1;
  view: RmtNftTerminalCatalogView;
  projects: readonly RmtNftTerminalProjectCard[];
  collections: readonly RmtNftTerminalCollectionCard[];
  newCollections: readonly RmtNftTerminalCollectionCard[];
  watchingCollections: readonly RmtNftTerminalCollectionCard[];
};

const TRENDING_OBSERVATION_MAX_AGE_MS = 15 * 60 * 1_000;

export function hasCurrentNftTrendingEvidence(marketplace: RmtNftProjectMarketplaceRead, now = new Date()): boolean {
  if (!["AVAILABLE", "PARTIAL"].includes(marketplace.availability) || marketplace.asOf === null) return false;
  const observedAt = Date.parse(marketplace.asOf);
  if (!Number.isFinite(observedAt) || observedAt > now.getTime() || now.getTime() - observedAt > TRENDING_OBSERVATION_MAX_AGE_MS) return false;
  return marketplace.volume24hByPaymentAsset.some((entry) => BigInt(entry.grossAmount) > 0n || entry.saleCount > 0);
}

export type RmtNftExactItemSearchResult =
  | { status: "NOT_APPLICABLE" }
  | { status: "CONFIRMED"; matches: readonly { project: RmtNftTerminalProjectCard; item: Exclude<RmtNftItemReaderResult, { availability: "UNAVAILABLE" }> }[] }
  | { status: "NOT_FOUND" }
  | { status: "UNAVAILABLE" };

export async function resolveExactRmtNftItemSearch(
  query: string,
  projects: readonly RmtNftTerminalProjectCard[],
  reader: (projectId: string, tokenId: string) => Promise<RmtNftItemReaderResult | null> = readRmtNftItem,
): Promise<RmtNftExactItemSearchResult> {
  const match = query.match(/^(?:(?<project>[a-z0-9-]+)\s*)?#?(?<token>0|[1-9]\d*)$/i);
  if (!match?.groups?.token) return { status: "NOT_APPLICABLE" };
  const projectQuery = match.groups.project?.toLowerCase();
  const candidates = projects.filter((entry) => !projectQuery || entry.projectId === projectQuery || entry.displayName.toLowerCase() === projectQuery);
  const results = await Promise.all(candidates.map(async (project) => ({ project, result: await reader(project.projectId, match.groups!.token!) })));
  const matches = results.flatMap(({ project, result }) => result && "tokenId" in result ? [{ project, item: result }] : []);
  if (matches.length) return { status: "CONFIRMED", matches };
  if (results.some(({ result }) => result && "availability" in result && result.availability === "UNAVAILABLE")) return { status: "UNAVAILABLE" };
  return { status: "NOT_FOUND" };
}

export function activePublicRmtNftProjects(projects?: readonly RmtCuratedNftProject[]) {
  const registryProjects = projects ?? activeRmtCuratedNftProjects();
  return registryProjects.filter((project): project is RmtCuratedNftProject & { status: "ACTIVE" } => project.status === "ACTIVE");
}

export function watchingPublicRmtNftProjects(
  projects: readonly RmtCuratedNftProject[] = RMT_CURATED_NFT_PROJECTS,
) {
  return projects.filter((project): project is RmtCuratedNftProject & { status: "WATCHING" } =>
    project.status === "WATCHING" && project.collections.every((collection) => collection.verificationStatus === "VERIFIED"));
}

function publicCollectionCards(projects: readonly RmtCuratedNftProject[]): RmtNftTerminalCollectionCard[] {
  return projects.flatMap((project) => project.collections.map((collection) => {
    const verification = rmtNftCollectionTechnicalVerification(project.projectId, collection.contractAddress);
    return {
      projectId: project.projectId,
      displayName: project.displayName,
      chainId: collection.chainId,
      contractAddress: collection.contractAddress,
      standard: collection.declaredStandard,
      verificationStatus: collection.verificationStatus,
      projectStatus: project.status as "ACTIVE" | "WATCHING",
      newEvidence: verification ? {
        authority: "TECHNICAL_VERIFICATION_OBSERVED" as const,
        observedAt: verification.verifiedAt,
        startBlock: verification.startBlock.toString(),
        deploymentTransaction: verification.deploymentTransaction,
      } : null,
      publicUrl: project.links.find((link) => link.visibility === "PUBLIC")?.url ?? null,
    };
  }));
}

export function recentlyVerifiedPublicRmtNftCollections(
  projects: readonly RmtCuratedNftProject[] = RMT_CURATED_NFT_PROJECTS,
): RmtNftTerminalCollectionCard[] {
  return publicCollectionCards([
    ...activePublicRmtNftProjects(projects),
    ...watchingPublicRmtNftProjects(projects),
  ]).filter((collection) => collection.newEvidence !== null).toSorted((left, right) =>
    right.newEvidence!.observedAt.localeCompare(left.newEvidence!.observedAt)
      || left.projectId.localeCompare(right.projectId)
      || left.contractAddress.localeCompare(right.contractAddress));
}

export function watchingPublicRmtNftCollections(projects?: readonly RmtCuratedNftProject[]) {
  return publicCollectionCards(watchingPublicRmtNftProjects(projects ?? RMT_CURATED_NFT_PROJECTS));
}

export function activePublicRmtNftCollections(projects?: readonly RmtCuratedNftProject[]) {
  return publicCollectionCards(activePublicRmtNftProjects(projects));
}

export function readRmtNftTerminalCatalog(view: RmtNftTerminalCatalogView): RmtNftTerminalCatalog {
  const admitted = activePublicRmtNftProjects();
  const projects = admitted.map((project): RmtNftTerminalProjectCard => ({
    projectId: project.projectId,
    displayName: project.displayName,
    status: "ACTIVE",
    rmtCurated: true,
    chainId: 4663,
    collections: project.collections.map((collection) => ({
      contractAddress: collection.contractAddress,
      standard: collection.declaredStandard,
      verificationStatus: collection.verificationStatus,
    })),
    projectToken: project.projectToken,
  }));
  return {
    schemaVersion: 1,
    view,
    projects,
    collections: view === "new"
      ? recentlyVerifiedPublicRmtNftCollections()
      : view === "watching"
        ? watchingPublicRmtNftCollections()
        : view === "minting"
          ? []
          : activePublicRmtNftCollections(),
    newCollections: recentlyVerifiedPublicRmtNftCollections(),
    watchingCollections: watchingPublicRmtNftCollections(),
  };
}
