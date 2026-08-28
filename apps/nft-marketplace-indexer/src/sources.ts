import {
  RMT_NFT_ACTIVITY_SOURCES,
  type RmtNftActivitySource,
} from "@rmt/shared/nft/activity-sources";

function sourceKey(source: RmtNftActivitySource) {
  return [
    source.chainId,
    source.projectId,
    source.collectionAddress.toLowerCase(),
    source.standard,
    source.deploymentTransaction.toLowerCase(),
    source.startBlock,
    source.runtimeBytecodeHash.toLowerCase(),
  ].join(":");
}

// Marketplace admission remains intentionally narrower than activity-source
// admission. WATCHING projects are not OpenSea polling inputs in this task.
export const RMT_NFT_MARKETPLACE_SOURCES = RMT_NFT_ACTIVITY_SOURCES.filter(
  (source) => source.projectId === "ccff00",
);

export function assertMarketplaceSourceSet(
  supplied: readonly RmtNftActivitySource[],
) {
  const reviewed = new Set(RMT_NFT_MARKETPLACE_SOURCES.map(sourceKey));
  const observed = new Set<string>();
  for (const source of supplied) {
    const key = sourceKey(source);
    if (observed.has(key))
      throw new Error("NFT marketplace source set contains a duplicate.");
    if (!reviewed.has(key))
      throw new Error(
        "NFT marketplace source is not in the reviewed marketplace source set.",
      );
    observed.add(key);
  }
  for (const key of reviewed)
    if (!observed.has(key))
      throw new Error("NFT marketplace source set omits a reviewed source.");
}
