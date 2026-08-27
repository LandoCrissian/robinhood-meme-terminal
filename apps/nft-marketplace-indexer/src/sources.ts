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
  ].join(":");
}

export function assertMarketplaceSourceSet(
  supplied: readonly RmtNftActivitySource[],
) {
  const reviewed = new Set(RMT_NFT_ACTIVITY_SOURCES.map(sourceKey));
  const observed = new Set<string>();
  for (const source of supplied) {
    const key = sourceKey(source);
    if (observed.has(key))
      throw new Error("NFT marketplace source set contains a duplicate.");
    if (!reviewed.has(key))
      throw new Error(
        "NFT marketplace source is not in RMT_NFT_ACTIVITY_SOURCES.",
      );
    observed.add(key);
  }
  for (const key of reviewed)
    if (!observed.has(key))
      throw new Error("NFT marketplace source set omits a reviewed source.");
}
