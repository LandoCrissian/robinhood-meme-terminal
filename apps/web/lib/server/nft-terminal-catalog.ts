import {
  activeRmtCuratedNftProjects,
  type RmtCuratedNftProject,
} from "@rmt/shared/nft/project-registry";
import {
  readRmtNftProjectInventory,
  readRmtNftProjectMarket,
  type RmtNftInventoryReaderResult,
} from "./nft-project-market";

export const NFT_TERMINAL_CATALOG_PREVIEW_LIMIT = 4 as const;

export type RmtNftTerminalCatalogView = "active" | "recent" | "collections";

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
};

export type RmtNftTerminalCatalog = {
  schemaVersion: 1;
  view: RmtNftTerminalCatalogView;
  projects: readonly RmtNftTerminalProjectCard[];
  collections: readonly RmtNftTerminalCollectionCard[];
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

export function activePublicRmtNftCollections(
  projects?: readonly RmtCuratedNftProject[],
): RmtNftTerminalCollectionCard[] {
  return activePublicRmtNftProjects(projects).flatMap((project) => project.collections.map((collection) => ({
    projectId: project.projectId,
    displayName: project.displayName,
    chainId: collection.chainId,
    contractAddress: collection.contractAddress,
    standard: collection.declaredStandard,
    verificationStatus: collection.verificationStatus,
  })));
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
  const admitted = view === "recent"
    ? recentlyAddedPublicRmtNftProjects()
    : activePublicRmtNftProjects();
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
    collections: view === "collections" ? activePublicRmtNftCollections() : [],
  };
}
