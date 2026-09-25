import {
  RMT_CURATED_NFT_PROJECTS,
  activeRmtCuratedNftProjects,
  type RmtCuratedNftProject,
} from "@rmt/shared/nft/project-registry";
import {
  readRmtNftProjectInventory,
  readRmtNftProjectMarket,
  type RmtNftInventoryReaderResult,
} from "./nft-project-market";

export const NFT_TERMINAL_CATALOG_PREVIEW_LIMIT = 4 as const;

export type RmtNftTerminalCatalogView = "active" | "new" | "minting" | "trending" | "watching";

export type RmtNftTerminalProjectCard = {
  projectId: string;
  displayName: string;
  status: "ACTIVE";
  rmtCurated: true;
  approvedAt: string;
  chainId: 4663;
  collections: readonly {
    contractAddress: `0x${string}`;
    standard: "ERC721" | "ERC1155" | null;
    verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
  }[];
  projectToken: RmtCuratedNftProject["projectToken"];
  market: Awaited<ReturnType<typeof readRmtNftProjectMarket>>;
  inventoryPreview: RmtNftInventoryReaderResult | null;
};

export type RmtNftTerminalCollectionCard = {
  projectId: string;
  displayName: string;
  chainId: 4663;
  contractAddress: `0x${string}`;
  standard: "ERC721" | "ERC1155" | null;
  verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
  projectStatus: "ACTIVE" | "WATCHING";
  verifiedAt: string;
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

export function activePublicRmtNftProjects(
  projects?: readonly RmtCuratedNftProject[],
) {
  const registryProjects = projects ?? activeRmtCuratedNftProjects();
  return registryProjects.filter((project): project is RmtCuratedNftProject & { status: "ACTIVE" } => project.status === "ACTIVE");
}

export function recentlyAddedPublicRmtNftProjects(
  projects?: readonly RmtCuratedNftProject[],
) {
  return activePublicRmtNftProjects(projects).toSorted((left, right) =>
    right.approvedAt.localeCompare(left.approvedAt) || left.projectId.localeCompare(right.projectId));
}

export function watchingPublicRmtNftProjects(
  projects: readonly RmtCuratedNftProject[] = RMT_CURATED_NFT_PROJECTS,
) {
  return projects.filter((project): project is RmtCuratedNftProject & { status: "WATCHING" } =>
    project.status === "WATCHING" && project.collections.every((collection) => collection.verificationStatus === "VERIFIED"));
}

function publicCollectionCards(projects: readonly RmtCuratedNftProject[]): RmtNftTerminalCollectionCard[] {
  return projects.flatMap((project) => project.collections.map((collection) => ({
    projectId: project.projectId,
    displayName: project.displayName,
    chainId: collection.chainId,
    contractAddress: collection.contractAddress,
    standard: collection.declaredStandard,
    verificationStatus: collection.verificationStatus,
    projectStatus: project.status as "ACTIVE" | "WATCHING",
    verifiedAt: project.approvedAt,
    publicUrl: project.links.find((link) => link.visibility === "PUBLIC")?.url ?? null,
  })));
}

export function recentlyVerifiedPublicRmtNftCollections(
  projects: readonly RmtCuratedNftProject[] = RMT_CURATED_NFT_PROJECTS,
): RmtNftTerminalCollectionCard[] {
  return publicCollectionCards([
    ...activePublicRmtNftProjects(projects),
    ...watchingPublicRmtNftProjects(projects),
  ]).toSorted((left, right) => right.verifiedAt.localeCompare(left.verifiedAt)
    || left.projectId.localeCompare(right.projectId)
    || left.contractAddress.localeCompare(right.contractAddress));
}

export function watchingPublicRmtNftCollections(
  projects?: readonly RmtCuratedNftProject[],
): RmtNftTerminalCollectionCard[] {
  return publicCollectionCards(watchingPublicRmtNftProjects(projects ?? RMT_CURATED_NFT_PROJECTS));
}

export function activePublicRmtNftCollections(
  projects?: readonly RmtCuratedNftProject[],
): RmtNftTerminalCollectionCard[] {
  return publicCollectionCards(activePublicRmtNftProjects(projects));
}

type CatalogReaders = {
  readMarket: typeof readRmtNftProjectMarket;
  readInventory: typeof readRmtNftProjectInventory;
};

async function mapBounded<T, U>(values: readonly T[], concurrency: number, worker: (value: T) => Promise<U>) {
  const results = new Array<U>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await worker(values[index]!);
    }
  }));
  return results;
}

export async function readRmtNftTerminalCatalog(
  view: RmtNftTerminalCatalogView,
  readers: CatalogReaders = {
    readMarket: readRmtNftProjectMarket,
    readInventory: readRmtNftProjectInventory,
  },
): Promise<RmtNftTerminalCatalog> {
  const admitted = activePublicRmtNftProjects();
  const projects = await mapBounded(admitted, 4, async (project): Promise<RmtNftTerminalProjectCard> => {
    const [market, inventoryPreview] = await Promise.all([
      readers.readMarket(project.projectId),
      readers.readInventory(project.projectId, { limit: NFT_TERMINAL_CATALOG_PREVIEW_LIMIT }),
    ]);
    return {
      projectId: project.projectId,
      displayName: project.displayName,
      status: "ACTIVE",
      rmtCurated: true,
      approvedAt: project.approvedAt,
      chainId: 4663,
      collections: project.collections.map((collection) => ({
        contractAddress: collection.contractAddress,
        standard: collection.declaredStandard,
        verificationStatus: collection.verificationStatus,
      })),
      projectToken: project.projectToken,
      market,
      inventoryPreview,
    };
  });
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
